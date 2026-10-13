package com.careerpilot.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.careerpilot.ai.AiCallResult;
import com.careerpilot.common.BusinessException;
import com.careerpilot.common.Hashing;
import com.careerpilot.dto.MatchDetail;
import com.careerpilot.dto.MatchDimensionScore;
import com.careerpilot.dto.MatchDimensionScores;
import com.careerpilot.dto.OptimizedResumeFile;
import com.careerpilot.dto.ResumeOptimizationCreateRequest;
import com.careerpilot.dto.ResumeOptimizationDetail;
import com.careerpilot.dto.ai.ChangeItem;
import com.careerpilot.dto.ai.ResumeAnalysisAiOutput;
import com.careerpilot.dto.ai.ResumeOptimizationAiOutput;
import com.careerpilot.entity.Job;
import com.careerpilot.entity.JobAnalysis;
import com.careerpilot.entity.MatchRecord;
import com.careerpilot.entity.Resume;
import com.careerpilot.entity.ResumeAnalysis;
import com.careerpilot.entity.ResumeOptimization;
import com.careerpilot.mapper.JobAnalysisMapper;
import com.careerpilot.mapper.JobMapper;
import com.careerpilot.mapper.MatchRecordMapper;
import com.careerpilot.mapper.ResumeAnalysisMapper;
import com.careerpilot.mapper.ResumeMapper;
import com.careerpilot.mapper.ResumeOptimizationMapper;
import com.careerpilot.service.ai.ResumeAiService;
import com.careerpilot.service.ai.ResumeOptimizationAiService;

/**
 * 简历定向优化业务编排的单测（《测试与验收方案》2.1 优化行）。
 *
 * 覆盖四条硬约束：缺分析/过期 → 400（不自动补齐）、失败不入库（模型调用先于 INSERT）、
 * **保存编辑不覆盖模型原稿**（旧稿进历史、上限 10 版）、重新评估**复用同一份岗位分析**。
 */
@ExtendWith(MockitoExtension.class)
class ResumeOptimizationServiceTest {

    private static final Long USER_ID = 7L;

    private static final Long RESUME_ID = 101L;

    private static final Long JOB_ID = 201L;

    private static final String DESCRIPTION = "岗位职责：参与核心业务开发\n任职要求：熟悉 Java";

    @Mock
    private ResumeOptimizationMapper optimizationMapper;

    @Mock
    private MatchRecordMapper matchRecordMapper;

    @Mock
    private ResumeMapper resumeMapper;

    @Mock
    private JobMapper jobMapper;

    @Mock
    private ResumeAnalysisMapper resumeAnalysisMapper;

    @Mock
    private JobAnalysisMapper jobAnalysisMapper;

    @Mock
    private ResumeService resumeService;

    @Mock
    private JobService jobService;

    @Mock
    private ResumeAnalysisService resumeAnalysisService;

    @Mock
    private JobAnalysisService jobAnalysisService;

    @Mock
    private MatchService matchService;

    @Mock
    private MatchScoringService matchScoringService;

    @Mock
    private ResumeOptimizationAiService resumeOptimizationAiService;

    @Mock
    private ResumeAiService resumeAiService;

    private ResumeOptimizationService service;

    @BeforeEach
    void setUp() {
        service = new ResumeOptimizationService(optimizationMapper, matchRecordMapper, resumeMapper, jobMapper,
                resumeAnalysisMapper, jobAnalysisMapper, resumeService, jobService, resumeAnalysisService,
                jobAnalysisService, matchService, matchScoringService, resumeOptimizationAiService, resumeAiService);
    }

    // ---------------------------------------------------------------- 创建前置校验

    @Test
    void create_missingResumeAnalysis_throwsBadRequestWithoutModelCall() {
        when(resumeService.getOwnedResume(USER_ID, RESUME_ID)).thenReturn(resume());
        when(jobService.getOwnedJob(USER_ID, JOB_ID)).thenReturn(job());
        when(resumeAnalysisService.findLatestSuccess(RESUME_ID)).thenReturn(null);

        assertThatThrownBy(() -> service.create(USER_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("请先完成简历分析");

        verify(matchService, never()).create(any(), any(), any(), any());
    }

    @Test
    void create_staleJobAnalysis_throwsBadRequest() {
        when(resumeService.getOwnedResume(USER_ID, RESUME_ID)).thenReturn(resume());
        when(jobService.getOwnedJob(USER_ID, JOB_ID)).thenReturn(job());
        when(resumeAnalysisService.findLatestSuccess(RESUME_ID)).thenReturn(resumeAnalysis());
        // source_hash 与当前描述不一致 → 过期
        JobAnalysis stale = jobAnalysis();
        stale.setSourceHash(Hashing.sha256Hex("另一份描述"));
        when(jobAnalysisService.findLatestSuccess(JOB_ID)).thenReturn(stale);

        assertThatThrownBy(() -> service.create(USER_ID, request()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("岗位描述已更新");

        verify(matchService, never()).create(any(), any(), any(), any());
    }

    // ---------------------------------------------------------------- 创建成功路径

    @Test
    void create_success_insertsRecordWithGeneratedContentAndAssemblesDetail() {
        stubHappyPath();
        ArgumentCaptor<ResumeOptimization> inserted = ArgumentCaptor.forClass(ResumeOptimization.class);

        ResumeOptimizationDetail detail = service.create(USER_ID, request());

        verify(optimizationMapper).insert(inserted.capture());
        ResumeOptimization record = inserted.getValue();
        assertThat(record.getVersionNo()).isEqualTo(1);
        assertThat(record.getMatchRecordId()).isEqualTo(501L);
        assertThat(record.getOptimizedContent()).contains("## 技能");
        assertThat(record.getChanges()).hasSize(1);
        assertThat(record.getGapQuestions()).containsExactly("项目的 QPS 是多少？");
        assertThat(record.getStatus()).isEqualTo(ResumeOptimization.STATUS_SUCCESS);

        assertThat(detail.getId()).isEqualTo(301L);
        assertThat(detail.getMatchScore()).isEqualTo(75.75);
        assertThat(detail.getScoreAfter()).isNull();
        assertThat(detail.getResumeName()).isEqualTo("Java后端简历");
        assertThat(detail.getJobName()).isEqualTo("Java 后端开发实习生");
        assertThat(detail.getResumeVersionNo()).isEqualTo(2);
        assertThat(detail.getJobVersionNo()).isEqualTo(1);
        assertThat(detail.getJobRequirements().getRequiredSkills()).containsExactly("Java");
        assertThat(detail.getResumeAdvantages()).containsExactly("技能组合与岗位相关");
    }

    // ---------------------------------------------------------------- 保存编辑稿

    @Test
    void saveContent_keepsModelOriginalAndPushesOldDraftToHistory() {
        ResumeOptimization record = storedRecord();
        record.setEditedContent("用户的第一版");
        when(optimizationMapper.selectOne(any())).thenReturn(record);
        stubDetailDependencies(record);

        service.saveContent(USER_ID, 301L, "用户的第二版");

        ArgumentCaptor<ResumeOptimization> updated = ArgumentCaptor.forClass(ResumeOptimization.class);
        verify(optimizationMapper).updateById(updated.capture());
        ResumeOptimization saved = updated.getValue();
        assertThat(saved.getEditedContent()).isEqualTo("用户的第二版");
        assertThat(saved.getOptimizedContent()).isEqualTo("## 技能\n- Java（模型原稿）");
        assertThat(saved.getEditHistory()).hasSize(1);
        assertThat(saved.getEditHistory().get(0).getContent()).isEqualTo("用户的第一版");
        assertThat(saved.getUpdatedAt()).isNotNull();
    }

    @Test
    void saveContent_sameContent_doesNotWriteOrCreateHistory() {
        ResumeOptimization record = storedRecord();
        record.setEditedContent("与当前一致");
        when(optimizationMapper.selectOne(any())).thenReturn(record);
        stubDetailDependencies(record);

        service.saveContent(USER_ID, 301L, "  与当前一致  "); // strip 后相同

        verify(optimizationMapper, never()).updateById(any(ResumeOptimization.class));
    }

    @Test
    void saveContent_historyLimitedToTen() {
        ResumeOptimization record = storedRecord();
        record.setEditedContent("当前稿");
        List<com.careerpilot.dto.EditSnapshot> history = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            history.add(new com.careerpilot.dto.EditSnapshot("旧稿 " + i, LocalDateTime.now()));
        }
        record.setEditHistory(history);
        when(optimizationMapper.selectOne(any())).thenReturn(record);
        stubDetailDependencies(record);

        service.saveContent(USER_ID, 301L, "新稿");

        ArgumentCaptor<ResumeOptimization> updated = ArgumentCaptor.forClass(ResumeOptimization.class);
        verify(optimizationMapper).updateById(updated.capture());
        List<com.careerpilot.dto.EditSnapshot> saved = updated.getValue().getEditHistory();
        assertThat(saved).hasSize(10);
        assertThat(saved.get(9).getContent()).isEqualTo("当前稿");
        assertThat(saved.get(0).getContent()).isEqualTo("旧稿 1");
    }

    // ---------------------------------------------------------------- 重新评估

    @Test
    void evaluate_reusesOriginalJobAnalysisAndWritesScoreAfter() {
        ResumeOptimization record = storedRecord();
        record.setEditedContent("用户最终稿");
        when(optimizationMapper.selectOne(any())).thenReturn(record);
        // 评估复用优化前那条 match_record 的岗位分析（同一份，保证前后可比）
        when(matchRecordMapper.selectById(501L)).thenReturn(matchRecord());
        when(jobAnalysisMapper.selectById(11L)).thenReturn(jobAnalysis());
        when(resumeAiService.analyze("用户最终稿"))
                .thenReturn(new AiCallResult<>(new ResumeAnalysisAiOutput(), "test-model", 10L, 1, 1, 2));
        when(matchScoringService.score(any(), any())).thenReturn(scoring());
        stubDetailDependencies(record);

        ResumeOptimizationDetail detail = service.evaluate(USER_ID, 301L);

        ArgumentCaptor<ResumeOptimization> updated = ArgumentCaptor.forClass(ResumeOptimization.class);
        verify(optimizationMapper).updateById(updated.capture());
        ResumeOptimization saved = updated.getValue();
        assertThat(saved.getScoreAfter()).isEqualByComparingTo("75.75");
        assertThat(saved.getDimensionScoresAfter().getRuleVersion()).isEqualTo("v1");
        assertThat(saved.getEvaluatedAt()).isNotNull();
        assertThat(detail.getScoreAfter()).isEqualTo(75.75);
    }

    // ---------------------------------------------------------------- 导出

    @Test
    void readExport_prefersEditedContentAndBuildsFileName() {
        ResumeOptimization record = storedRecord();
        record.setEditedContent("用户最终稿");
        when(optimizationMapper.selectOne(any())).thenReturn(record);
        when(resumeMapper.selectById(RESUME_ID)).thenReturn(resume());
        when(jobMapper.selectById(JOB_ID)).thenReturn(job());

        OptimizedResumeFile file = service.readExport(USER_ID, 301L);

        assertThat(file.getContent()).isEqualTo("用户最终稿");
        assertThat(file.getFileName()).isEqualTo("Java后端简历-Java 后端开发实习生-优化稿.docx");
    }

    @Test
    void detail_otherUsersRecord_throws404() {
        when(optimizationMapper.selectOne(any())).thenReturn(null);

        assertThatThrownBy(() -> service.detail(USER_ID, 301L))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("优化记录不存在");
    }

    // ---------------------------------------------------------------- 辅助

    private void stubHappyPath() {
        when(resumeService.getOwnedResume(USER_ID, RESUME_ID)).thenReturn(resume());
        when(jobService.getOwnedJob(USER_ID, JOB_ID)).thenReturn(job());
        when(resumeAnalysisService.findLatestSuccess(RESUME_ID)).thenReturn(resumeAnalysis());
        when(jobAnalysisService.findLatestSuccess(JOB_ID)).thenReturn(jobAnalysis());
        when(matchService.create(any(), any(), any(), any())).thenReturn(matchDetail());
        when(matchScoringService.score(any(), any())).thenReturn(scoring());
        when(resumeOptimizationAiService.generate(any(), any(), any(), any())).thenReturn(generated());
        // 版本号查询（首次创建 → MAX 为空）
        when(optimizationMapper.selectOne(any())).thenReturn(null);
        doAnswer(invocation -> {
            ResumeOptimization record = invocation.getArgument(0);
            record.setId(301L);
            return 1;
        }).when(optimizationMapper).insert(any(ResumeOptimization.class));
        stubDetailDependencies(null);
    }

    /** toDetail 的关联查询（stubHappyPath 与各写路径共用） */
    private void stubDetailDependencies(ResumeOptimization ignored) {
        when(matchRecordMapper.selectById(501L)).thenReturn(matchRecord());
        when(jobAnalysisMapper.selectById(11L)).thenReturn(jobAnalysis());
        when(resumeAnalysisMapper.selectById(21L)).thenReturn(resumeAnalysis());
        when(resumeMapper.selectById(RESUME_ID)).thenReturn(resume());
        when(jobMapper.selectById(JOB_ID)).thenReturn(job());
    }

    private static ResumeOptimizationCreateRequest request() {
        ResumeOptimizationCreateRequest request = new ResumeOptimizationCreateRequest();
        request.setResumeId(RESUME_ID);
        request.setJobId(JOB_ID);
        return request;
    }

    private static Resume resume() {
        Resume resume = new Resume();
        resume.setId(RESUME_ID);
        resume.setUserId(USER_ID);
        resume.setName("Java后端简历");
        resume.setContent("张三 / Java 后端开发");
        return resume;
    }

    private static Job job() {
        Job job = new Job();
        job.setId(JOB_ID);
        job.setUserId(USER_ID);
        job.setJobName("Java 后端开发实习生");
        job.setCompanyName("示例科技");
        job.setDescription(DESCRIPTION);
        return job;
    }

    private static ResumeAnalysis resumeAnalysis() {
        ResumeAnalysis analysis = new ResumeAnalysis();
        analysis.setId(21L);
        analysis.setResumeId(RESUME_ID);
        analysis.setVersionNo(2);
        analysis.setAdvantages(List.of("技能组合与岗位相关"));
        return analysis;
    }

    private static JobAnalysis jobAnalysis() {
        JobAnalysis analysis = new JobAnalysis();
        analysis.setId(11L);
        analysis.setJobId(JOB_ID);
        analysis.setVersionNo(1);
        analysis.setSourceHash(Hashing.sha256Hex(DESCRIPTION));
        analysis.setRequiredSkills(List.of("Java"));
        return analysis;
    }

    private static MatchRecord matchRecord() {
        MatchRecord record = new MatchRecord();
        record.setId(501L);
        record.setResumeAnalysisId(21L);
        record.setJobAnalysisId(11L);
        record.setMatchScore(new BigDecimal("75.75"));
        record.setDimensionScores(dimensionScores());
        record.setMatchedItems(List.of());
        record.setPartialItems(List.of());
        record.setMissingItems(List.of());
        return record;
    }

    private static MatchDetail matchDetail() {
        MatchDetail detail = new MatchDetail();
        detail.setId(501L);
        detail.setMatchScore(75.75);
        return detail;
    }

    private static MatchScoringResult scoring() {
        return new MatchScoringResult(new BigDecimal("75.75"), dimensionScores(), List.of());
    }

    private static MatchDimensionScores dimensionScores() {
        List<MatchDimensionScore> items = List.of(
                new MatchDimensionScore("requiredSkills", "必备技能", 45, 80));
        return new MatchDimensionScores("v1", items);
    }

    private static AiCallResult<ResumeOptimizationAiOutput> generated() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java（模型原稿）");
        ChangeItem item = new ChangeItem();
        item.setSection("技能");
        item.setType("KEYWORD");
        item.setReason("对齐岗位关键词");
        item.setBefore("Java");
        item.setAfter("Java（项目主力语言）");
        output.setChanges(List.of(item));
        output.setGapQuestions(List.of("项目的 QPS 是多少？"));
        return new AiCallResult<>(output, "test-model", 100L, 1, 1, 2);
    }

    private static ResumeOptimization storedRecord() {
        ResumeOptimization record = new ResumeOptimization();
        record.setId(301L);
        record.setUserId(USER_ID);
        record.setResumeId(RESUME_ID);
        record.setJobId(JOB_ID);
        record.setMatchRecordId(501L);
        record.setVersionNo(1);
        record.setOptimizedContent("## 技能\n- Java（模型原稿）");
        record.setChanges(List.of());
        record.setGapQuestions(List.of());
        record.setStatus(ResumeOptimization.STATUS_SUCCESS);
        record.setCreatedAt(LocalDateTime.now());
        record.setUpdatedAt(LocalDateTime.now());
        return record;
    }

}
