package com.careerpilot.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.Jackson3TypeHandler;

import com.careerpilot.dto.EditSnapshot;
import com.careerpilot.dto.MatchDimensionScores;
import com.careerpilot.dto.ai.ChangeItem;
import com.careerpilot.dto.ai.ResumeAnalysisAiOutput;

/**
 * 简历定向优化记录，对应《数据库设计》中的 {@code resume_optimization}（第 11 张表，V1.6 新增）。
 *
 * <p>JSON 列的处理方式同 MatchRecord / ResumeAnalysis（《数据库设计》5.5）：
 * autoResultMap + Jackson3TypeHandler；{@code changes} 的元素类型 {@link ChangeItem}
 * 与 API 响应共用，**落库即响应、零转换**。
 *
 * <p>三层内容分列（《数据库设计》5.11，实现与文案均不得混淆）：
 * <ul>
 *   <li>{@code optimizedContent}——模型原稿，写入后不可变；</li>
 *   <li>{@code editedContent}——用户当前稿，可覆盖自身；旧稿在覆盖前推入 {@code editHistory}；</li>
 *   <li>{@code resume.content}——原始简历，本表不触碰（"不覆盖原始简历"的验收项）。</li>
 * </ul>
 * 展示、评估与导出统一取 {@code editedContent}（为空时回落 {@code optimizedContent}）。
 *
 * <p>本表是全项目唯一可被用户 UPDATE 的业务表，{@code updatedAt} 由服务层**显式写入**
 * （MySQL 的 ON UPDATE 不刷新未变化的行，见《数据库设计》5.9 的同类坑）。
 */
@TableName(value = "resume_optimization", autoResultMap = true)
public class ResumeOptimization {

    /** 记录状态：成功（第一版只存成功结果，同《数据库设计》5.3） */
    public static final String STATUS_SUCCESS = "SUCCESS";

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long resumeId;

    private Long jobId;

    /** 优化前匹配评估对应的 match_record.id（优化链路先匹配、后改写） */
    private Long matchRecordId;

    /** 同一简历+岗位组合的优化版本号，从 1 递增（唯一键兜底，冲突重试见 Service） */
    private Integer versionNo;

    /** 模型输出的优化后简历（Markdown 原稿，不可变） */
    private String optimizedContent;

    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<ChangeItem> changes;

    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<String> gapQuestions;

    /** 用户编辑后的当前稿（不覆盖 optimizedContent） */
    private String editedContent;

    /** 编辑历史快照（最多 10 版，超出丢最旧；上限在服务层强制） */
    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<EditSnapshot> editHistory;

    /** 优化后匹配总分（0.00–100.00，重新评估时由规则计算写入） */
    private BigDecimal scoreAfter;

    @TableField(typeHandler = Jackson3TypeHandler.class)
    private MatchDimensionScores dimensionScoresAfter;

    /** 优化稿的结构化分析（评估依据，追溯用；不写入 resume_analysis） */
    @TableField(typeHandler = Jackson3TypeHandler.class)
    private ResumeAnalysisAiOutput optimizedAnalysis;

    /** 最近一次评估时间 */
    private LocalDateTime evaluatedAt;

    private String modelName;

    private String status;

    private String errorMessage;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getResumeId() {
        return resumeId;
    }

    public void setResumeId(Long resumeId) {
        this.resumeId = resumeId;
    }

    public Long getJobId() {
        return jobId;
    }

    public void setJobId(Long jobId) {
        this.jobId = jobId;
    }

    public Long getMatchRecordId() {
        return matchRecordId;
    }

    public void setMatchRecordId(Long matchRecordId) {
        this.matchRecordId = matchRecordId;
    }

    public Integer getVersionNo() {
        return versionNo;
    }

    public void setVersionNo(Integer versionNo) {
        this.versionNo = versionNo;
    }

    public String getOptimizedContent() {
        return optimizedContent;
    }

    public void setOptimizedContent(String optimizedContent) {
        this.optimizedContent = optimizedContent;
    }

    public List<ChangeItem> getChanges() {
        return changes;
    }

    public void setChanges(List<ChangeItem> changes) {
        this.changes = changes;
    }

    public List<String> getGapQuestions() {
        return gapQuestions;
    }

    public void setGapQuestions(List<String> gapQuestions) {
        this.gapQuestions = gapQuestions;
    }

    public String getEditedContent() {
        return editedContent;
    }

    public void setEditedContent(String editedContent) {
        this.editedContent = editedContent;
    }

    public List<EditSnapshot> getEditHistory() {
        return editHistory;
    }

    public void setEditHistory(List<EditSnapshot> editHistory) {
        this.editHistory = editHistory;
    }

    public BigDecimal getScoreAfter() {
        return scoreAfter;
    }

    public void setScoreAfter(BigDecimal scoreAfter) {
        this.scoreAfter = scoreAfter;
    }

    public MatchDimensionScores getDimensionScoresAfter() {
        return dimensionScoresAfter;
    }

    public void setDimensionScoresAfter(MatchDimensionScores dimensionScoresAfter) {
        this.dimensionScoresAfter = dimensionScoresAfter;
    }

    public ResumeAnalysisAiOutput getOptimizedAnalysis() {
        return optimizedAnalysis;
    }

    public void setOptimizedAnalysis(ResumeAnalysisAiOutput optimizedAnalysis) {
        this.optimizedAnalysis = optimizedAnalysis;
    }

    public LocalDateTime getEvaluatedAt() {
        return evaluatedAt;
    }

    public void setEvaluatedAt(LocalDateTime evaluatedAt) {
        this.evaluatedAt = evaluatedAt;
    }

    public String getModelName() {
        return modelName;
    }

    public void setModelName(String modelName) {
        this.modelName = modelName;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

}
