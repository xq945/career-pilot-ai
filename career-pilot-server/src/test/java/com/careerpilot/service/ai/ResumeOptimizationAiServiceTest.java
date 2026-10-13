package com.careerpilot.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import com.careerpilot.ai.AiCallResult;
import com.careerpilot.ai.AiCallTemplate;
import com.careerpilot.common.BusinessException;
import com.careerpilot.dto.MatchDimensionScore;
import com.careerpilot.dto.MatchDimensionScores;
import com.careerpilot.dto.ai.ChangeItem;
import com.careerpilot.dto.ai.ResumeOptimizationAiOutput;
import com.careerpilot.entity.JobAnalysis;
import com.careerpilot.entity.Resume;
import com.careerpilot.entity.ResumeAnalysis;
import com.careerpilot.service.MatchScoringResult;

/**
 * 简历优化清洗的护栏（《API接口设计》§6A、《Agent设计》6.4）。
 *
 * 覆盖四条硬要求：优化稿超长截断与**空稿 50201**、changes 元素的结构校验
 * （缺 section/after 丢弃、type 白名单外置 null）、措辞守卫、gapQuestions 去重与上限。
 */
class ResumeOptimizationAiServiceTest {

    private AiCallTemplate template;

    private ResumeOptimizationAiService service;

    @BeforeEach
    void setUp() {
        template = mock(AiCallTemplate.class);
        // 读真实提示词资源：模板缺失同样让测试失败（与"启动即失败"的约定一致）
        service = new ResumeOptimizationAiService(
                template, new ClassPathResource("prompts/resume-optimization.system.txt"));
    }

    @Test
    void sanitize_truncatesContentAndLists() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("简历正文".repeat(3000)); // 12000 字符
        List<ChangeItem> many = new ArrayList<>();
        for (int i = 0; i < 35; i++) {
            many.add(change("项目经历", "REWRITE", "理由 " + i, "原文", "改写后 " + i));
        }
        output.setChanges(many);
        output.setGapQuestions(new ArrayList<>(Collections.nCopies(15, "请确认某项信息？")));

        ResumeOptimizationAiOutput cleaned = run(output);

        assertEquals(8000, cleaned.getOptimizedContent().length());
        assertEquals(30, cleaned.getChanges().size());
        assertEquals(1, cleaned.getGapQuestions().size(), "重复问题必须去重");
    }

    @Test
    void sanitize_dropsChangesMissingSectionOrAfter() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java");
        output.setChanges(new ArrayList<>(List.of(
                change("项目经历", "REWRITE", "理由", "原文", "改写后"),
                change(null, "REWRITE", "理由", "原文", "改写后"),
                change("技能", "REWRITE", "理由", "原文", null))));

        ResumeOptimizationAiOutput cleaned = run(output);

        assertEquals(1, cleaned.getChanges().size(), "缺 section 或 after 的元素必须丢弃");
        assertEquals("项目经历", cleaned.getChanges().get(0).getSection());
    }

    @Test
    void sanitize_changeTypeOutOfRangeBecomesNull() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java");
        output.setChanges(new ArrayList<>(List.of(
                change("个人总结", "REWRITE_TO_BETTER", "理由", "原文", "改写后"))));

        ResumeOptimizationAiOutput cleaned = run(output);

        assertEquals(1, cleaned.getChanges().size(), "type 越界只置 null，不丢弃整条");
        assertNull(cleaned.getChanges().get(0).getType());
    }

    @Test
    void sanitize_dropsChangesWithForbiddenWording() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java");
        output.setChanges(new ArrayList<>(List.of(
                change("个人总结", "REWRITE", "你并不具备该能力，因此改写", "原文", "改写后"),
                change("技能", "KEYWORD", "对齐岗位关键词", "原文", "改写后"))));

        ResumeOptimizationAiOutput cleaned = run(output);

        assertEquals(1, cleaned.getChanges().size(), "命中禁用措辞的修改说明必须整条丢弃");
        assertEquals("技能", cleaned.getChanges().get(0).getSection());
    }

    @Test
    void sanitize_truncatesChangeTextFields() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java");
        output.setChanges(new ArrayList<>(List.of(
                change("项目经历", "REWRITE", "理由".repeat(400), "原文".repeat(400), "改写".repeat(400)))));

        ResumeOptimizationAiOutput cleaned = run(output);

        ChangeItem item = cleaned.getChanges().get(0);
        assertEquals(500, item.getReason().length());
        assertEquals(500, item.getBefore().length());
        assertEquals(500, item.getAfter().length());
    }

    @Test
    void sanitize_gapQuestionsFilteredAndTruncated() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java");
        output.setGapQuestions(new ArrayList<>(List.of(
                "项目的 QPS 是多少？",
                "  ",
                "项目的 QPS 是多少？",
                "很长的追问".repeat(100))));

        ResumeOptimizationAiOutput cleaned = run(output);

        assertEquals(2, cleaned.getGapQuestions().size());
        assertEquals(200, cleaned.getGapQuestions().get(1).length());
    }

    @Test
    void sanitize_topLevelScoreFieldsAreDropped() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("## 技能\n- Java");
        // 模拟模型试图输出/覆盖分数：输出类型无这些字段，只会被收集
        output.putUnknownField("matchScore", 150);
        output.putUnknownField("scoreAfter", 90);

        ResumeOptimizationAiOutput cleaned = run(output);

        assertTrue(cleaned.drainUnknownFields().isEmpty(), "清洗后约定外字段必须已被取出清空");
    }

    @Test
    void generate_blankContentThrows50201() {
        ResumeOptimizationAiOutput output = new ResumeOptimizationAiOutput();
        output.setOptimizedContent("   ");

        BusinessException ex = assertThrows(BusinessException.class, () -> run(output));

        assertEquals(50201, ex.getCode(), "空优化稿必须按输出无法解析处理（不落空记录）");
    }

    // ---------------------------------------------------------------- 辅助

    private ResumeOptimizationAiOutput run(ResumeOptimizationAiOutput output) {
        when(template.call(eq("resume-optimization"), anyString(), anyString(),
                eq(ResumeOptimizationAiOutput.class)))
                .thenReturn(new AiCallResult<>(output, "test-model", 100L, 1, 1, 2));
        return service.generate(resume(), new JobAnalysis(), new ResumeAnalysis(), scoring()).value();
    }

    private static Resume resume() {
        Resume resume = new Resume();
        resume.setContent("张三 / Java 后端开发\n技能：Java、Spring Boot");
        return resume;
    }

    private static ChangeItem change(String section, String type, String reason,
                                     String before, String after) {
        ChangeItem item = new ChangeItem();
        item.setSection(section);
        item.setType(type);
        item.setReason(reason);
        item.setBefore(before);
        item.setAfter(after);
        return item;
    }

    private static MatchScoringResult scoring() {
        List<MatchDimensionScore> items = List.of(
                new MatchDimensionScore("requiredSkills", "必备技能", 45, 80));
        return new MatchScoringResult(new BigDecimal("80.00"),
                new MatchDimensionScores("v1", items), List.of());
    }

}
