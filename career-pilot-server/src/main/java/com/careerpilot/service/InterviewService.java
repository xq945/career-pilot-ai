package com.careerpilot.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.careerpilot.ai.AiCallResult;
import com.careerpilot.common.BusinessException;
import com.careerpilot.common.PageQuery;
import com.careerpilot.common.PageResult;
import com.careerpilot.dto.AnswerEvaluationResponse;
import com.careerpilot.dto.CategoryScore;
import com.careerpilot.dto.InterviewCreateRequest;
import com.careerpilot.dto.InterviewCreateResponse;
import com.careerpilot.dto.InterviewDetail;
import com.careerpilot.dto.InterviewQuestionItem;
import com.careerpilot.dto.InterviewQuestionView;
import com.careerpilot.dto.InterviewReport;
import com.careerpilot.dto.InterviewView;
import com.careerpilot.dto.ReportQuestion;
import com.careerpilot.dto.ai.InterviewEvaluationAiOutput;
import com.careerpilot.dto.ai.InterviewQuestionsAiOutput;
import com.careerpilot.dto.ai.InterviewSummaryAiOutput;
import com.careerpilot.dto.ai.MatchItem;
import com.careerpilot.entity.InterviewQuestion;
import com.careerpilot.entity.InterviewSession;
import com.careerpilot.entity.Job;
import com.careerpilot.entity.JobAnalysis;
import com.careerpilot.entity.MatchRecord;
import com.careerpilot.entity.Resume;
import com.careerpilot.entity.ResumeOptimization;
import com.careerpilot.mapper.InterviewQuestionMapper;
import com.careerpilot.mapper.InterviewSessionMapper;
import com.careerpilot.mapper.JobAnalysisMapper;
import com.careerpilot.mapper.JobMapper;
import com.careerpilot.mapper.MatchRecordMapper;
import com.careerpilot.mapper.ResumeMapper;
import com.careerpilot.mapper.ResumeOptimizationMapper;
import com.careerpilot.service.ai.InterviewAiService;

/**
 * 面试业务编排（《API接口设计》§7）：创建、提交回答、列表、详情、报告。
 *
 * <p>本类**不加事务**：写路径全部委托 {@link InterviewTxService}（独立 bean，代理生效），
 * 且模型调用一律发生在事务之外——任何 502 都先于写入抛出，天然满足"失败不入库"
 * （与 M4/M5 的既有范式一致，M7 只是把多行写入的事务边界补上）。
 *
 * <p>归属校验（{@link #getOwnedSession}）一律带 user_id、查不到返回 404，不区分
 * "不存在"与"他人"（《API接口设计》§1/A01）。
 *
 * <p>读路径的装配遵循"两次查询、无 N+1、无自定义 SQL"的项目范式；
 * 关联岗位的名称查询**刻意不过滤 status**——岗位被逻辑删除后名称仍要显示（§7.3）。
 */
@Service
public class InterviewService {

    private static final Logger log = LoggerFactory.getLogger(InterviewService.class);

    /** 能力差距块：missing / partial 各取的条数上限（M12，收口方案 §4.3） */
    private static final int GAP_ITEMS_PER_KIND = 5;

    private final InterviewSessionMapper interviewSessionMapper;

    private final InterviewQuestionMapper interviewQuestionMapper;

    private final JobMapper jobMapper;

    private final JobAnalysisMapper jobAnalysisMapper;

    private final JobService jobService;

    private final InterviewAiService interviewAiService;

    private final InterviewTxService interviewTxService;

    // M12（《一体化工作流收口方案》§4.3）：来源与出题上下文装配
    private final ResumeService resumeService;

    private final ResumeOptimizationService resumeOptimizationService;

    private final MatchRecordMapper matchRecordMapper;

    private final ResumeMapper resumeMapper;

    private final ResumeOptimizationMapper resumeOptimizationMapper;

    public InterviewService(InterviewSessionMapper interviewSessionMapper,
                            InterviewQuestionMapper interviewQuestionMapper,
                            JobMapper jobMapper,
                            JobAnalysisMapper jobAnalysisMapper,
                            JobService jobService,
                            InterviewAiService interviewAiService,
                            InterviewTxService interviewTxService,
                            ResumeService resumeService,
                            ResumeOptimizationService resumeOptimizationService,
                            MatchRecordMapper matchRecordMapper,
                            ResumeMapper resumeMapper,
                            ResumeOptimizationMapper resumeOptimizationMapper) {
        this.interviewSessionMapper = interviewSessionMapper;
        this.interviewQuestionMapper = interviewQuestionMapper;
        this.jobMapper = jobMapper;
        this.jobAnalysisMapper = jobAnalysisMapper;
        this.jobService = jobService;
        this.interviewAiService = interviewAiService;
        this.interviewTxService = interviewTxService;
        this.resumeService = resumeService;
        this.resumeOptimizationService = resumeOptimizationService;
        this.matchRecordMapper = matchRecordMapper;
        this.resumeMapper = resumeMapper;
        this.resumeOptimizationMapper = resumeOptimizationMapper;
    }

    // ---------------------------------------------------------------- 创建会话（§7.1）

    /**
     * 创建面试会话：出题（模型，事务外）→ 会话与题目同一事务落库。
     *
     * 岗位归属校验**先于模型调用**（他人岗位不白烧 token）；出题失败（50200/50201）
     * 先于任何写入抛出，不产生空会话。
     */
    public InterviewCreateResponse create(Long userId, InterviewCreateRequest request) {
        Job job = jobService.getOwnedJob(userId, request.getJobId());

        // 岗位分析仅作参考增强：未分析或已过期时只用岗位描述（过期的分析会带偏出题方向）
        JobAnalysis analysis = latestUsableAnalysis(job);

        // M12：来源与出题上下文（归属/一致性校验在内；无来源时退化为历史行为）
        CreateContext context = resolveCreateContext(userId, request);

        // 模型调用（通常 10–40 秒）：事务之外
        AiCallResult<InterviewQuestionsAiOutput> result = interviewAiService.generate(
                job, analysis, request.getQuestionType(), request.getQuestionCount(),
                context.resumeText(), context.gapItems());

        InterviewSession session = new InterviewSession();
        session.setUserId(userId);
        session.setJobId(job.getId());
        session.setResumeId(context.resumeId());
        session.setOptimizationId(context.optimizationId());
        session.setTitle(request.getTitle().trim());
        session.setQuestionType(request.getQuestionType());
        session.setQuestionCount(request.getQuestionCount());
        session.setStatus(InterviewSession.STATUS_ONGOING);
        // 显式设置时间并裁到秒（MP 不回读库默认值；DATETIME(0) 对齐防跨接口 1 秒抖动）
        LocalDateTime now = LocalDateTime.now().withNano(0);
        session.setCreatedAt(now);
        session.setUpdatedAt(now);

        List<InterviewQuestion> questions = interviewTxService.saveNewSession(
                session, result.value().getQuestions());
        return toCreateResponse(session, questions);
    }

    /**
     * 最新一版**可用**的岗位分析：无成功分析、或分析已过期（描述被改过）时返回 null。
     * 过期判定复用 {@link JobAnalysisService#isStale}（与列表/分析接口同一口径）。
     */
    private JobAnalysis latestUsableAnalysis(Job job) {
        JobAnalysis latest = jobAnalysisMapper.selectOne(Wrappers.<JobAnalysis>lambdaQuery()
                .eq(JobAnalysis::getJobId, job.getId())
                .eq(JobAnalysis::getStatus, JobAnalysis.STATUS_SUCCESS)
                .orderByDesc(JobAnalysis::getVersionNo)
                .last("LIMIT 1"));
        return JobAnalysisService.isStale(job.getDescription(), latest) ? null : latest;
    }

    // ---------------------------------------------------------------- 来源与出题上下文（M12）

    /**
     * 装配创建请求的来源与出题上下文（《一体化工作流收口方案》§4.3）。
     *
     * <p>三条规则（全部「有则带、无则退」——缺分析或匹配记录**不报错**，只减少上下文）：
     * <ol>
     *   <li>提供 {@code optimizationId}：校验归属（他人 → 404）与一致性（优化岗位必须与
     *       {@code jobId} 一致；显式 {@code resumeId} 必须与优化的 resumeId 一致，否则 400）；
     *       简历块取优化稿当前稿，差距块取该优化的 match_record；</li>
     *   <li>仅提供 {@code resumeId}：校验归属（他人 → 404）；简历块取简历提取文本，
     *       差距块取「简历 × 岗位」最近一条 match_record（无则不带）；</li>
     *   <li>均不提供：无上下文，出题行为与历史完全一致。</li>
     * </ol>
     *
     * <p>会话落库时 {@code resume_id} 由服务端从优化推导（《数据库设计》§5.12），
     * 不接受前端组合出不一致的三元组。
     */
    private CreateContext resolveCreateContext(Long userId, InterviewCreateRequest request) {
        if (request.getOptimizationId() != null) {
            ResumeOptimization optimization =
                    resumeOptimizationService.getOwned(userId, request.getOptimizationId());
            if (!optimization.getJobId().equals(request.getJobId())) {
                throw BusinessException.badRequest("所选优化记录与目标岗位不一致");
            }
            if (request.getResumeId() != null
                    && !request.getResumeId().equals(optimization.getResumeId())) {
                throw BusinessException.badRequest("所选简历与优化记录不一致");
            }
            MatchRecord match = matchRecordMapper.selectById(optimization.getMatchRecordId());
            return new CreateContext(optimization.getResumeId(), optimization.getId(),
                    ResumeOptimizationService.currentContent(optimization), gapItems(match));
        }

        if (request.getResumeId() != null) {
            Resume resume = resumeService.getOwnedResume(userId, request.getResumeId());
            MatchRecord latest = latestMatch(userId, resume.getId(), request.getJobId());
            return new CreateContext(resume.getId(), null, resume.getContent(), gapItems(latest));
        }

        return new CreateContext(null, null, null, null);
    }

    /** 「简历 × 岗位」的最近一条匹配记录（无则 null）；仅用于能力差距块，不影响出题成败 */
    private MatchRecord latestMatch(Long userId, Long resumeId, Long jobId) {
        return matchRecordMapper.selectOne(Wrappers.<MatchRecord>lambdaQuery()
                .eq(MatchRecord::getUserId, userId)
                .eq(MatchRecord::getResumeId, resumeId)
                .eq(MatchRecord::getJobId, jobId)
                .orderByDesc(MatchRecord::getCreatedAt)
                .orderByDesc(MatchRecord::getId)
                .last("LIMIT 1"));
    }

    /**
     * 能力差距块：missing 在前、partial 在后，各取前 {@value #GAP_ITEMS_PER_KIND} 条；
     * 无匹配记录或无差距项时返回 null（不装配空块——空块会引导模型想象）。
     */
    private static List<MatchItem> gapItems(MatchRecord match) {
        if (match == null) {
            return null;
        }
        List<MatchItem> items = new ArrayList<>();
        appendGaps(items, match.getMissingItems());
        appendGaps(items, match.getPartialItems());
        return items.isEmpty() ? null : items;
    }

    private static void appendGaps(List<MatchItem> target, List<MatchItem> source) {
        if (source == null) {
            return;
        }
        source.stream().limit(GAP_ITEMS_PER_KIND).forEach(target::add);
    }

    /** 创建来源与出题上下文：三者可各自为 null（无上下文，与历史行为一致） */
    private record CreateContext(Long resumeId, Long optimizationId, String resumeText,
                                 List<MatchItem> gapItems) {
    }

    // ---------------------------------------------------------------- 提交回答（§7.2）

    /**
     * 提交回答并评价：预检（归属/状态）→ 模型评价（事务外，失败零写入）→
     * 落库（事务）→ 会话完成时生成总评（**失败不阻断**，见 §7.4 V2.5）。
     *
     * 同一题重复提交覆盖上一次的评价，得分以最后一次为准（幂等）；
     * 已完成会话的重答同样即时重算总分。
     */
    public AnswerEvaluationResponse submitAnswer(Long userId, Long sessionId, Long questionId,
                                                 String answer) {
        InterviewSession session = getOwnedSession(userId, sessionId);
        if (session.getStatus() != null && session.getStatus() == InterviewSession.STATUS_CANCELLED) {
            throw BusinessException.badRequest("该面试会话已取消，无法提交回答");
        }
        InterviewQuestion question = getOwnedQuestion(sessionId, questionId);
        Job job = requireJob(session.getJobId());

        // 模型调用（通常 10–30 秒）：事务之外；失败（50200/50201）不写入任何数据
        AiCallResult<InterviewEvaluationAiOutput> result =
                interviewAiService.evaluate(job, question, answer);

        InterviewTxService.AnswerOutcome outcome = interviewTxService.applyAnswerAndRecompute(
                userId, sessionId, questionId, answer, result.value());

        if (outcome.completed()) {
            generateSummarySafely(job, session, outcome);
        }

        AnswerEvaluationResponse response = new AnswerEvaluationResponse();
        response.setQuestionId(questionId);
        response.setScore(result.value().getScore());
        response.setAnalysis(result.value().getAnalysis());
        response.setReferenceAnswer(result.value().getReferenceAnswer());
        response.setSuggestions(result.value().getSuggestions());
        return response;
    }

    /**
     * 生成并写入总评（§7.4 V2.5）：与总分同一触发时机（本次提交使会话处于完成状态）。
     *
     * **失败不阻断**：回答、评价、总分此时均已落库，总评失败只记日志、不使整个提交失败；
     * 总评保持缺失时报告页不渲染该区块，用户重答任一题会重新生成。
     */
    private void generateSummarySafely(Job job, InterviewSession session,
                                       InterviewTxService.AnswerOutcome outcome) {
        try {
            AiCallResult<InterviewSummaryAiOutput> summary = interviewAiService.summarize(
                    job, session.getQuestionType(), outcome.questions(), outcome.totalScore());
            interviewTxService.saveSummary(session.getId(), summary.value());
        }
        catch (RuntimeException ex) {
            log.warn("总评生成失败，本次提交仍成功（可重答触发重新生成）：sessionId={} 异常={}",
                    session.getId(), ex.getClass().getSimpleName());
        }
    }

    // ---------------------------------------------------------------- 列表与详情（§7.3）

    /** 列表：created_at 倒序（id 倒序作稳定排序 tie-breaker），内联岗位名称与进度计数 */
    public PageResult<InterviewView> list(Long userId, PageQuery query) {
        Page<InterviewSession> page = new Page<>(query.getPage(), query.getSize());
        IPage<InterviewSession> result = interviewSessionMapper.selectPage(page,
                Wrappers.<InterviewSession>lambdaQuery()
                        .eq(InterviewSession::getUserId, userId)
                        .orderByDesc(InterviewSession::getCreatedAt)
                        .orderByDesc(InterviewSession::getId));

        List<InterviewSession> sessions = result.getRecords();
        Map<Long, Job> jobById = findJobsByIds(sessions);
        Map<Long, QuestionCounts> countsBySessionId = countQuestionsBySessionIds(sessions);
        // M12：来源资源批量查询（两次查询、内存装配，无 N+1，沿用本类既有范式）
        Map<Long, Resume> resumeById = findResumesByIds(sessions);
        Map<Long, ResumeOptimization> optimizationById = findOptimizationsByIds(sessions);

        List<InterviewView> records = sessions.stream()
                .map(session -> toView(session, jobById.get(session.getJobId()),
                        countsBySessionId.get(session.getId()),
                        session.getResumeId() == null ? null : resumeById.get(session.getResumeId()),
                        session.getOptimizationId() == null
                                ? null : optimizationById.get(session.getOptimizationId())))
                .toList();
        return PageResult.of(result, records);
    }

    /** 详情：会话 + 全部题目（含已提交的回答与评价），题目按 sortOrder 升序 */
    public InterviewDetail detail(Long userId, Long id) {
        InterviewSession session = getOwnedSession(userId, id);
        List<InterviewQuestion> questions = listQuestions(session.getId());

        InterviewDetail detail = new InterviewDetail();
        fillSessionFields(detail, session, findJob(session.getJobId()), questions);
        // M12：来源展示（源资源逻辑删除后名称/版本号仍要显示）
        Resume sourceResume = findSourceResume(session.getResumeId());
        ResumeOptimization sourceOptimization = findSourceOptimization(session.getOptimizationId());
        detail.setResumeId(session.getResumeId());
        detail.setResumeName(sourceResume == null ? null : sourceResume.getName());
        detail.setOptimizationId(session.getOptimizationId());
        detail.setOptimizationVersionNo(
                sourceOptimization == null ? null : sourceOptimization.getVersionNo());
        detail.setQuestions(questions.stream().map(InterviewService::toQuestionView).toList());
        return detail;
    }

    /** 报告（§7.4）：只读已写入的总分与总评，不做任何惰性计算 */
    public InterviewReport report(Long userId, Long id) {
        InterviewSession session = getOwnedSession(userId, id);
        Job job = findJob(session.getJobId());
        List<InterviewQuestion> questions = listQuestions(session.getId());

        long answeredCount = questions.stream().filter(question -> question.getAnswer() != null).count();
        boolean completed = !questions.isEmpty() && answeredCount == questions.size();

        InterviewReport report = new InterviewReport();
        report.setSessionId(session.getId());
        report.setTitle(session.getTitle());
        report.setJobId(session.getJobId());
        if (job != null) {
            report.setJobName(job.getJobName());
            report.setCompanyName(job.getCompanyName());
        }
        // M12：来源展示（同 detail，源资源逻辑删除后仍显示）
        Resume sourceResume = findSourceResume(session.getResumeId());
        ResumeOptimization sourceOptimization = findSourceOptimization(session.getOptimizationId());
        report.setResumeId(session.getResumeId());
        report.setResumeName(sourceResume == null ? null : sourceResume.getName());
        report.setOptimizationId(session.getOptimizationId());
        report.setOptimizationVersionNo(
                sourceOptimization == null ? null : sourceOptimization.getVersionNo());
        report.setQuestionType(session.getQuestionType());
        report.setStatus(session.getStatus());
        report.setQuestionCount(session.getQuestionCount());
        report.setAnsweredCount((int) answeredCount);
        report.setCompleted(completed);
        // 只读已写入的值：未完成时总分必为 null（写入规则见 InterviewTxService）；
        // 报告接口绝不重算、绝不触发模型调用（《API接口设计》§7.4 / R21）
        report.setTotalScore(completed ? session.getTotalScore() : null);
        report.setCompletedAt(session.getCompletedAt());
        report.setOverallSummary(completed ? session.getOverallSummary() : null);
        report.setStrengths(completed ? session.getStrengths() : null);
        report.setWeaknesses(completed ? session.getWeaknesses() : null);
        report.setRecommendations(completed ? session.getRecommendations() : null);
        // 分类得分仅统计已作答题目（未完成时返回部分统计）
        report.setCategoryScores(categoryScores(questions));
        report.setQuestions(questions.stream().map(InterviewService::toReportQuestion).toList());
        return report;
    }

    // ---------------------------------------------------------------- 归属校验与查询

    /**
     * 会话归属校验：查不到（不存在或属于他人）一律 404。
     * M8 的 Agent 工具如需读取会话也从此入口复用。
     */
    public InterviewSession getOwnedSession(Long userId, Long id) {
        InterviewSession session = interviewSessionMapper.selectOne(
                Wrappers.<InterviewSession>lambdaQuery()
                        .eq(InterviewSession::getId, id)
                        .eq(InterviewSession::getUserId, userId));
        if (session == null) {
            throw BusinessException.notFound("面试会话不存在");
        }
        return session;
    }

    /** 题目归属：必须属于路径中的会话，否则 404 */
    private InterviewQuestion getOwnedQuestion(Long sessionId, Long questionId) {
        InterviewQuestion question = interviewQuestionMapper.selectOne(
                Wrappers.<InterviewQuestion>lambdaQuery()
                        .eq(InterviewQuestion::getId, questionId)
                        .eq(InterviewQuestion::getSessionId, sessionId));
        if (question == null) {
            throw BusinessException.notFound("面试题目不存在");
        }
        return question;
    }

    /**
     * 按 job_id 读取岗位（**不过滤 status**）：会话已建立后，岗位即使被逻辑删除，
     * 名称仍要显示（§7.3）、评价仍需要描述文本；FK RESTRICT 保证行始终存在。
     */
    private Job requireJob(Long jobId) {
        Job job = jobMapper.selectById(jobId);
        if (job == null) {
            throw BusinessException.notFound("关联岗位不存在");
        }
        return job;
    }

    /** 同 {@link #requireJob}，但装配场景允许缺失（返回 null，名称字段留空） */
    private Job findJob(Long jobId) {
        return jobMapper.selectById(jobId);
    }

    private List<InterviewQuestion> listQuestions(Long sessionId) {
        return interviewQuestionMapper.selectList(Wrappers.<InterviewQuestion>lambdaQuery()
                .eq(InterviewQuestion::getSessionId, sessionId)
                .orderByAsc(InterviewQuestion::getSortOrder));
    }

    /** 批量查询当页会话的关联岗位（列表内联名称用；**不带 status 过滤**，§7.3） */
    private Map<Long, Job> findJobsByIds(List<InterviewSession> sessions) {
        List<Long> jobIds = sessions.stream().map(InterviewSession::getJobId).distinct().toList();
        if (jobIds.isEmpty()) {
            return Map.of();
        }
        List<Job> jobs = jobMapper.selectList(Wrappers.<Job>lambdaQuery()
                .select(Job::getId, Job::getJobName, Job::getCompanyName)
                .in(Job::getId, jobIds));
        return jobs.stream().collect(Collectors.toMap(Job::getId, Function.identity()));
    }

    /** 批量查询当页会话的来源简历（**不带 status 过滤**：源资源逻辑删除后名称仍要显示） */
    private Map<Long, Resume> findResumesByIds(List<InterviewSession> sessions) {
        List<Long> ids = sessions.stream()
                .map(InterviewSession::getResumeId)
                .filter(id -> id != null)
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return resumeMapper.selectList(Wrappers.<Resume>lambdaQuery()
                        .select(Resume::getId, Resume::getName)
                        .in(Resume::getId, ids))
                .stream().collect(Collectors.toMap(Resume::getId, Function.identity()));
    }

    /** 批量查询当页会话的来源优化记录（**不带 status 过滤**） */
    private Map<Long, ResumeOptimization> findOptimizationsByIds(List<InterviewSession> sessions) {
        List<Long> ids = sessions.stream()
                .map(InterviewSession::getOptimizationId)
                .filter(id -> id != null)
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return resumeOptimizationMapper.selectList(Wrappers.<ResumeOptimization>lambdaQuery()
                        .select(ResumeOptimization::getId, ResumeOptimization::getVersionNo)
                        .in(ResumeOptimization::getId, ids))
                .stream().collect(Collectors.toMap(ResumeOptimization::getId, Function.identity()));
    }

    /** 来源简历单条查询（可空入参 → null），**不过滤 status**（同 {@link #findResumesByIds}） */
    private Resume findSourceResume(Long resumeId) {
        return resumeId == null ? null : resumeMapper.selectById(resumeId);
    }

    /** 来源优化记录单条查询（可空入参 → null） */
    private ResumeOptimization findSourceOptimization(Long optimizationId) {
        return optimizationId == null ? null : resumeOptimizationMapper.selectById(optimizationId);
    }

    /**
     * 批量统计当页会话的题目数与已作答数（两次查询、内存聚合，无 N+1）。
     *
     * `generatedCount` 即题目行数（不落库，G-3）；`answeredCount` 为 `answer IS NOT NULL`
     * 的计数——评价失败不写入，故不存在"有回答、无得分"的中间态（§7.2）。
     */
    private Map<Long, QuestionCounts> countQuestionsBySessionIds(List<InterviewSession> sessions) {
        List<Long> sessionIds = sessions.stream().map(InterviewSession::getId).toList();
        if (sessionIds.isEmpty()) {
            return Map.of();
        }
        List<InterviewQuestion> questions = interviewQuestionMapper.selectList(
                Wrappers.<InterviewQuestion>lambdaQuery()
                        .select(InterviewQuestion::getSessionId, InterviewQuestion::getAnswer)
                        .in(InterviewQuestion::getSessionId, sessionIds));
        Map<Long, QuestionCounts> counts = new HashMap<>();
        for (InterviewQuestion question : questions) {
            QuestionCounts current = counts.get(question.getSessionId());
            int total = current == null ? 0 : current.generatedCount();
            int answered = current == null ? 0 : current.answeredCount();
            counts.put(question.getSessionId(),
                    new QuestionCounts(total + 1, question.getAnswer() == null ? answered : answered + 1));
        }
        return counts;
    }

    /** 按类别分组求平均分（仅已作答题目）；组顺序按题目 sortOrder 首次出现顺序，稳定免硬编码 */
    private static List<CategoryScore> categoryScores(List<InterviewQuestion> questions) {
        Map<String, List<java.math.BigDecimal>> grouped = new LinkedHashMap<>();
        for (InterviewQuestion question : questions) {
            if (question.getAnswer() == null) {
                continue;
            }
            // LinkedHashMap 允许 null key：未分类题目归入 category=null 组（与总分口径一致）
            grouped.computeIfAbsent(question.getQuestionCategory(), key -> new ArrayList<>())
                    .add(question.getScore());
        }
        List<CategoryScore> scores = new ArrayList<>(grouped.size());
        grouped.forEach((category, values) -> {
            CategoryScore score = new CategoryScore();
            score.setCategory(category);
            score.setAverageScore(InterviewTxService.averageScore(values));
            score.setQuestionCount(values.size());
            scores.add(score);
        });
        return scores;
    }

    // ---------------------------------------------------------------- 装配

    private static InterviewCreateResponse toCreateResponse(InterviewSession session,
                                                            List<InterviewQuestion> questions) {
        InterviewCreateResponse response = new InterviewCreateResponse();
        response.setId(session.getId());
        response.setTitle(session.getTitle());
        response.setQuestionType(session.getQuestionType());
        response.setQuestionCount(session.getQuestionCount());
        response.setGeneratedCount(questions.size());
        response.setStatus(session.getStatus());
        response.setCreatedAt(session.getCreatedAt());
        response.setQuestions(questions.stream().map(question -> {
            InterviewQuestionItem item = new InterviewQuestionItem();
            item.setId(question.getId());
            item.setQuestion(question.getQuestion());
            item.setQuestionCategory(question.getQuestionCategory());
            item.setSortOrder(question.getSortOrder());
            return item;
        }).toList());
        return response;
    }

    private InterviewView toView(InterviewSession session, Job job, QuestionCounts counts,
                                 Resume resume, ResumeOptimization optimization) {
        InterviewView view = new InterviewView();
        view.setId(session.getId());
        view.setTitle(session.getTitle());
        view.setJobId(session.getJobId());
        if (job != null) {
            view.setJobName(job.getJobName());
            view.setCompanyName(job.getCompanyName());
        }
        // M12：来源展示（源资源逻辑删除后名称/版本号仍要显示，§7.3）
        view.setResumeId(session.getResumeId());
        view.setResumeName(resume == null ? null : resume.getName());
        view.setOptimizationId(session.getOptimizationId());
        view.setOptimizationVersionNo(optimization == null ? null : optimization.getVersionNo());
        view.setQuestionType(session.getQuestionType());
        view.setQuestionCount(session.getQuestionCount());
        view.setGeneratedCount(counts == null ? 0 : counts.generatedCount());
        view.setAnsweredCount(counts == null ? 0 : counts.answeredCount());
        view.setStatus(session.getStatus());
        view.setTotalScore(session.getTotalScore());
        view.setCreatedAt(session.getCreatedAt());
        return view;
    }

    /** 会话字段 → 详情（列表字段 + 由题目行实时计算的计数） */
    private static void fillSessionFields(InterviewDetail detail, InterviewSession session,
                                          Job job, List<InterviewQuestion> questions) {
        long answeredCount = questions.stream().filter(question -> question.getAnswer() != null).count();
        detail.setId(session.getId());
        detail.setTitle(session.getTitle());
        detail.setJobId(session.getJobId());
        if (job != null) {
            detail.setJobName(job.getJobName());
            detail.setCompanyName(job.getCompanyName());
        }
        detail.setQuestionType(session.getQuestionType());
        detail.setQuestionCount(session.getQuestionCount());
        detail.setGeneratedCount(questions.size());
        detail.setAnsweredCount((int) answeredCount);
        detail.setStatus(session.getStatus());
        detail.setTotalScore(session.getTotalScore());
        detail.setCreatedAt(session.getCreatedAt());
    }

    private static InterviewQuestionView toQuestionView(InterviewQuestion question) {
        InterviewQuestionView view = new InterviewQuestionView();
        view.setId(question.getId());
        view.setQuestion(question.getQuestion());
        view.setQuestionCategory(question.getQuestionCategory());
        view.setSortOrder(question.getSortOrder());
        view.setAnswer(question.getAnswer());
        view.setScore(question.getScore());
        view.setAnalysis(question.getAnalysis());
        view.setReferenceAnswer(question.getReferenceAnswer());
        view.setSuggestions(question.getSuggestions());
        return view;
    }

    private static ReportQuestion toReportQuestion(InterviewQuestion question) {
        ReportQuestion item = new ReportQuestion();
        item.setQuestionId(question.getId());
        item.setQuestion(question.getQuestion());
        item.setQuestionCategory(question.getQuestionCategory());
        item.setScore(question.getScore());
        item.setAnswered(question.getAnswer() != null);
        item.setAnswer(question.getAnswer());
        item.setAnalysis(question.getAnalysis());
        return item;
    }

    /** 会话的题目计数（列表装配用） */
    private record QuestionCounts(int generatedCount, int answeredCount) {
    }

}
