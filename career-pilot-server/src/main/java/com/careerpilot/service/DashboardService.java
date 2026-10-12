package com.careerpilot.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.careerpilot.dto.DashboardGapItem;
import com.careerpilot.dto.DashboardRecentMatch;
import com.careerpilot.dto.DashboardSummary;
import com.careerpilot.dto.ai.MatchItem;
import com.careerpilot.entity.InterviewSession;
import com.careerpilot.entity.Job;
import com.careerpilot.entity.JobAnalysis;
import com.careerpilot.entity.MatchRecord;
import com.careerpilot.entity.Resume;
import com.careerpilot.entity.ResumeAnalysis;
import com.careerpilot.mapper.InterviewSessionMapper;
import com.careerpilot.mapper.JobAnalysisMapper;
import com.careerpilot.mapper.JobMapper;
import com.careerpilot.mapper.MatchRecordMapper;
import com.careerpilot.mapper.ResumeAnalysisMapper;
import com.careerpilot.mapper.ResumeMapper;

/**
 * 仪表盘汇总服务（《API接口设计》9.1）。
 *
 * <p>只读、只服务仪表盘单一页面，不做通用化；各计数为独立查询、**第一版不做缓存**。
 * 全部查询带 user_id 过滤（与其余接口的归属校验要求一致）。
 *
 * <p>口径与各模块列表严格一致（这是验收标准「仪表盘所有数字与各模块实际数据一致」的前提）：
 * 简历 / 岗位只计 {@code status = 1}；分析只计成功态；岗位过期复用
 * {@link JobAnalysisService#isStale} 单点（因此 {@code jobStaleCount ⊆ jobAnalyzedCount} 天然成立）；
 * 面试 {@code status = 2}（已取消）不计入任何计数。
 *
 * <p>无自定义 SQL、无 N+1：沿用 M4–M6 的「两次查询 + 内存装配」范式；
 * 空集合一律先短路（不发 {@code IN ()}）。
 */
@Service
public class DashboardService {

    /** 最近匹配记录条数（9.1 定死 5） */
    private static final int RECENT_MATCH_LIMIT = 5;

    /** 能力差距概览条数上限（9.1 定死 3：missing 在前、partial 在后） */
    private static final int TOP_GAP_LIMIT = 3;

    /** topGaps 的 type 取值（明细项无 type 列，由来源列表决定） */
    private static final String GAP_TYPE_MISSING = "MISSING";

    private static final String GAP_TYPE_PARTIAL = "PARTIAL";

    private final ResumeMapper resumeMapper;

    private final ResumeAnalysisMapper resumeAnalysisMapper;

    private final JobMapper jobMapper;

    private final JobAnalysisMapper jobAnalysisMapper;

    private final MatchRecordMapper matchRecordMapper;

    private final InterviewSessionMapper interviewSessionMapper;

    public DashboardService(ResumeMapper resumeMapper, ResumeAnalysisMapper resumeAnalysisMapper,
                            JobMapper jobMapper, JobAnalysisMapper jobAnalysisMapper,
                            MatchRecordMapper matchRecordMapper, InterviewSessionMapper interviewSessionMapper) {
        this.resumeMapper = resumeMapper;
        this.resumeAnalysisMapper = resumeAnalysisMapper;
        this.jobMapper = jobMapper;
        this.jobAnalysisMapper = jobAnalysisMapper;
        this.matchRecordMapper = matchRecordMapper;
        this.interviewSessionMapper = interviewSessionMapper;
    }

    /** 汇总（9.1）：12 个字段一次装配返回 */
    public DashboardSummary summary(Long userId) {
        DashboardSummary summary = new DashboardSummary();
        summary.setResumeCount(countOf(resumeMapper.selectCount(Wrappers.<Resume>lambdaQuery()
                .eq(Resume::getUserId, userId)
                .eq(Resume::getStatus, Resume.STATUS_ACTIVE))));
        summary.setResumeAnalyzedCount(resumeAnalyzedCount(userId));
        summary.setJobCount(countOf(jobMapper.selectCount(Wrappers.<Job>lambdaQuery()
                .eq(Job::getUserId, userId)
                .eq(Job::getStatus, Job.STATUS_ACTIVE))));
        JobCounts jobCounts = jobCounts(userId);
        summary.setJobAnalyzedCount(jobCounts.analyzed());
        summary.setJobStaleCount(jobCounts.stale());
        summary.setMatchCount(countOf(matchRecordMapper.selectCount(Wrappers.<MatchRecord>lambdaQuery()
                .eq(MatchRecord::getUserId, userId))));
        summary.setBestMatchScore(bestMatchScore(userId));
        summary.setInterviewCount(countOf(interviewSessionMapper.selectCount(Wrappers.<InterviewSession>lambdaQuery()
                .eq(InterviewSession::getUserId, userId))));
        summary.setInterviewOngoingCount(countOf(interviewSessionMapper.selectCount(
                Wrappers.<InterviewSession>lambdaQuery()
                        .eq(InterviewSession::getUserId, userId)
                        .eq(InterviewSession::getStatus, InterviewSession.STATUS_ONGOING))));
        summary.setInterviewCompletedCount(countOf(interviewSessionMapper.selectCount(
                Wrappers.<InterviewSession>lambdaQuery()
                        .eq(InterviewSession::getUserId, userId)
                        .eq(InterviewSession::getStatus, InterviewSession.STATUS_COMPLETED))));
        summary.setRecentMatches(recentMatches(userId));
        summary.setTopGaps(topGaps(userId));
        return summary;
    }

    // ---------------------------------------------------------------- 简历 / 岗位计数

    /**
     * 已有成功分析的**有效简历**数（9.1 口径：有效简历 ∩ 有成功分析，去重）。
     *
     * <p>不能直接数 resume_analysis 行——该表没有 user_id 列，且同一简历可能有多版本分析；
     * 故先取本人有效简历 id，再取其成功分析的**去重 resume_id** 计数。
     */
    private int resumeAnalyzedCount(Long userId) {
        List<Long> resumeIds = resumeMapper.selectList(Wrappers.<Resume>lambdaQuery()
                        .select(Resume::getId)
                        .eq(Resume::getUserId, userId)
                        .eq(Resume::getStatus, Resume.STATUS_ACTIVE))
                .stream().map(Resume::getId).toList();
        if (resumeIds.isEmpty()) {
            return 0;
        }
        Set<Long> analyzedResumeIds = resumeAnalysisMapper.selectList(Wrappers.<ResumeAnalysis>lambdaQuery()
                        .select(ResumeAnalysis::getResumeId)
                        .in(ResumeAnalysis::getResumeId, resumeIds)
                        .eq(ResumeAnalysis::getStatus, ResumeAnalysis.STATUS_SUCCESS))
                .stream().map(ResumeAnalysis::getResumeId).collect(Collectors.toSet());
        return analyzedResumeIds.size();
    }

    /** 岗位的 analyzed / stale 计数（一次查询算出两个数，相关性由口径天然保证） */
    private JobCounts jobCounts(Long userId) {
        List<Job> jobs = jobMapper.selectList(Wrappers.<Job>lambdaQuery()
                .select(Job::getId, Job::getDescription)
                .eq(Job::getUserId, userId)
                .eq(Job::getStatus, Job.STATUS_ACTIVE));
        if (jobs.isEmpty()) {
            return new JobCounts(0, 0);
        }
        Map<Long, JobAnalysis> latestByJobId = latestSuccessByJobIds(jobs);
        int stale = 0;
        for (Job job : jobs) {
            // isStale 对 latest == null 短路为 false（无分析的岗位不计 stale）
            if (JobAnalysisService.isStale(job.getDescription(), latestByJobId.get(job.getId()))) {
                stale += 1;
            }
        }
        return new JobCounts(latestByJobId.size(), stale);
    }

    /**
     * 本人有效岗位的最新成功分析（**全量版**，{@link JobService#latestSuccessByJobIds} 的同款算法）。
     *
     * <p>列表侧的该查询限「当页」（private）；仪表盘需全量，故按 user 全量重写，
     * 算法保持「一次 IN 查询 + 内存按 jobId 取 versionNo 最大」不变
     * （走 idx_job_analysis_hash 的最左前缀 job_id）；只 select 判定所需的三列。
     */
    private Map<Long, JobAnalysis> latestSuccessByJobIds(List<Job> jobs) {
        List<Long> jobIds = jobs.stream().map(Job::getId).toList();
        List<JobAnalysis> analyses = jobAnalysisMapper.selectList(Wrappers.<JobAnalysis>lambdaQuery()
                .select(JobAnalysis::getJobId, JobAnalysis::getVersionNo, JobAnalysis::getSourceHash)
                .in(JobAnalysis::getJobId, jobIds)
                .eq(JobAnalysis::getStatus, JobAnalysis.STATUS_SUCCESS));
        Map<Long, JobAnalysis> latestByJobId = new HashMap<>();
        for (JobAnalysis analysis : analyses) {
            JobAnalysis current = latestByJobId.get(analysis.getJobId());
            if (current == null || analysis.getVersionNo() > current.getVersionNo()) {
                latestByJobId.put(analysis.getJobId(), analysis);
            }
        }
        return latestByJobId;
    }

    // ---------------------------------------------------------------- 匹配

    /** 历史最高分；无记录时 null（BigDecimal → double，避免 82.40 尾零） */
    private Double bestMatchScore(Long userId) {
        MatchRecord best = matchRecordMapper.selectOne(Wrappers.<MatchRecord>lambdaQuery()
                .select(MatchRecord::getMatchScore)
                .eq(MatchRecord::getUserId, userId)
                .orderByDesc(MatchRecord::getMatchScore)
                .orderByDesc(MatchRecord::getId)
                .last("LIMIT 1"));
        return best == null ? null : best.getMatchScore().doubleValue();
    }

    /** 最近 5 条匹配（created_at 倒序、id 倒序兜底；内联名称不过滤 status） */
    private List<DashboardRecentMatch> recentMatches(Long userId) {
        Page<MatchRecord> page = new Page<>(1, RECENT_MATCH_LIMIT);
        IPage<MatchRecord> result = matchRecordMapper.selectPage(page, Wrappers.<MatchRecord>lambdaQuery()
                .eq(MatchRecord::getUserId, userId)
                .orderByDesc(MatchRecord::getCreatedAt)
                .orderByDesc(MatchRecord::getId));
        List<MatchRecord> records = result.getRecords();
        if (records.isEmpty()) {
            return List.of();
        }
        Map<Long, Resume> resumes = resumesByIds(records);
        Map<Long, Job> jobs = jobsByIds(records);
        return records.stream().map(record -> {
            DashboardRecentMatch item = new DashboardRecentMatch();
            item.setId(record.getId());
            item.setResumeId(record.getResumeId());
            item.setResumeName(resumes.get(record.getResumeId()).getName());
            item.setJobId(record.getJobId());
            item.setJobName(jobs.get(record.getJobId()).getJobName());
            item.setCompanyName(jobs.get(record.getJobId()).getCompanyName());
            item.setMatchScore(record.getMatchScore().doubleValue());
            item.setCreatedAt(record.getCreatedAt());
            return item;
        }).toList();
    }

    /** 最近一次匹配的差距项：missing 在前、partial 在后，最多 3 条；无记录时空数组 */
    private List<DashboardGapItem> topGaps(Long userId) {
        MatchRecord latest = matchRecordMapper.selectOne(Wrappers.<MatchRecord>lambdaQuery()
                .eq(MatchRecord::getUserId, userId)
                .orderByDesc(MatchRecord::getCreatedAt)
                .orderByDesc(MatchRecord::getId)
                .last("LIMIT 1"));
        if (latest == null) {
            return List.of();
        }
        List<DashboardGapItem> gaps = new ArrayList<>();
        appendGaps(gaps, latest.getMissingItems(), GAP_TYPE_MISSING);
        appendGaps(gaps, latest.getPartialItems(), GAP_TYPE_PARTIAL);
        return gaps.size() > TOP_GAP_LIMIT ? List.copyOf(gaps.subList(0, TOP_GAP_LIMIT)) : gaps;
    }

    /** 明细项 → 差距项投影（text 与 dimension 原样转出；null 列表安全） */
    private static void appendGaps(List<DashboardGapItem> gaps, List<MatchItem> items, String type) {
        if (items == null) {
            return;
        }
        for (MatchItem item : items) {
            DashboardGapItem gap = new DashboardGapItem();
            gap.setType(type);
            gap.setText(item.getText());
            gap.setDimension(item.getDimension());
            gaps.add(gap);
        }
    }

    // ---------------------------------------------------------------- 关联查询（当页批量，无 N+1）

    /** 当页记录关联的简历（**不过滤 status**：源资源逻辑删除后名称仍要显示，同 6.2） */
    private Map<Long, Resume> resumesByIds(List<MatchRecord> records) {
        List<Long> ids = records.stream().map(MatchRecord::getResumeId).distinct().toList();
        return resumeMapper.selectList(Wrappers.<Resume>lambdaQuery()
                        .select(Resume::getId, Resume::getName)
                        .in(Resume::getId, ids))
                .stream().collect(Collectors.toMap(Resume::getId, Function.identity()));
    }

    /** 当页记录关联的岗位（**不过滤 status**，同上） */
    private Map<Long, Job> jobsByIds(List<MatchRecord> records) {
        List<Long> ids = records.stream().map(MatchRecord::getJobId).distinct().toList();
        return jobMapper.selectList(Wrappers.<Job>lambdaQuery()
                        .select(Job::getId, Job::getJobName, Job::getCompanyName)
                        .in(Job::getId, ids))
                .stream().collect(Collectors.toMap(Job::getId, Function.identity()));
    }

    private static int countOf(Long count) {
        return count == null ? 0 : count.intValue();
    }

    /** 岗位 analyzed / stale 两个计数的载体（一次查询算出，避免重复扫表） */
    private record JobCounts(int analyzed, int stale) {
    }

}
