package com.careerpilot.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.Jackson3TypeHandler;

/**
 * 面试会话，对应《数据库设计》中的 interview_session（V1.4 起含 4 个总评列）。
 *
 * <p>状态机（《API接口设计》§7）：0 进行中、1 已完成、2 已取消（保留备用，
 * 第一版无接口可置 2，仅提交回答时需拒绝该状态）。
 *
 * <p>总分与总评的写入规则（§7.4，V2.5 补充总评）：
 * <ul>
 *   <li>{@code totalScore}：全部题目作答时由提交回答触发计算并写入（题均分，两位小数），
 *       已完成会话重答时即时重算；报告接口只读、不做惰性计算；</li>
 *   <li>{@code completedAt}：**仅首次完成时写入**（重答保持首次值）；</li>
 *   <li>{@code overallSummary} 与三个 JSON 列：与总分同一写入时机由模型生成；
 *       <b>生成失败不阻断提交回答</b>，此时保持 null，重答即修复。</li>
 * </ul>
 *
 * <p>JSON 列的处理方式同 JobAnalysis / MatchRecord（《数据库设计》5.5）：
 * autoResultMap + Jackson3TypeHandler。列表元素为纯字符串，无元素 DTO。
 */
@TableName(value = "interview_session", autoResultMap = true)
public class InterviewSession {

    /** 进行中（默认）：题目已生成，尚未全部作答 */
    public static final int STATUS_ONGOING = 0;

    /** 已完成：全部题目均已作答（总分已写） */
    public static final int STATUS_COMPLETED = 1;

    /** 已取消：第一版保留备用、无接口可置（《API接口设计》§7 范围说明） */
    public static final int STATUS_CANCELLED = 2;

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long jobId;

    private String title;

    /** JAVA/SPRING/MYSQL/REDIS/PROJECT/MIXED（白名单，创建时校验） */
    private String questionType;

    /** **计划**题目数，创建会话时确定（实际数量见题目行数，即 generatedCount） */
    private Integer questionCount;

    /** 0 进行中、1 已完成、2 已取消（见常量） */
    private Integer status;

    /** 全部作答后计算的题均分（两位小数），未完成时恒为 null */
    private BigDecimal totalScore;

    /** AI 总评（一句话），会话完成时写入；生成失败/未完成时为 null */
    private String overallSummary;

    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<String> strengths;

    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<String> weaknesses;

    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<String> recommendations;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    /** 首次完成时间（重答不刷新） */
    private LocalDateTime completedAt;

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

    public Long getJobId() {
        return jobId;
    }

    public void setJobId(Long jobId) {
        this.jobId = jobId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getQuestionType() {
        return questionType;
    }

    public void setQuestionType(String questionType) {
        this.questionType = questionType;
    }

    public Integer getQuestionCount() {
        return questionCount;
    }

    public void setQuestionCount(Integer questionCount) {
        this.questionCount = questionCount;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public BigDecimal getTotalScore() {
        return totalScore;
    }

    public void setTotalScore(BigDecimal totalScore) {
        this.totalScore = totalScore;
    }

    public String getOverallSummary() {
        return overallSummary;
    }

    public void setOverallSummary(String overallSummary) {
        this.overallSummary = overallSummary;
    }

    public List<String> getStrengths() {
        return strengths;
    }

    public void setStrengths(List<String> strengths) {
        this.strengths = strengths;
    }

    public List<String> getWeaknesses() {
        return weaknesses;
    }

    public void setWeaknesses(List<String> weaknesses) {
        this.weaknesses = weaknesses;
    }

    public List<String> getRecommendations() {
        return recommendations;
    }

    public void setRecommendations(List<String> recommendations) {
        this.recommendations = recommendations;
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

    public LocalDateTime getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(LocalDateTime completedAt) {
        this.completedAt = completedAt;
    }

}
