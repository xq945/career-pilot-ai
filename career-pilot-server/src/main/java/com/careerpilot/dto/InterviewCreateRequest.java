package com.careerpilot.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 创建面试会话的请求体（《API接口设计》§7.1）。
 *
 * 题目在创建时一次性生成，`questionCount` 是**计划**数量（落库 question_count）；
 * 实际生成并落库的题数以行数统计（响应中的 generatedCount），可能少于计划值。
 */
public class InterviewCreateRequest {

    @NotNull(message = "岗位不能为空")
    private Long jobId;

    @NotBlank(message = "面试名称不能为空")
    @Size(max = 100, message = "面试名称不能超过 100 个字符")
    private String title;

    @NotBlank(message = "题型不能为空")
    @Pattern(regexp = "JAVA|SPRING|MYSQL|REDIS|PROJECT|MIXED",
            message = "题型必须是 JAVA、SPRING、MYSQL、REDIS、PROJECT、MIXED 之一")
    private String questionType;

    @NotNull(message = "题目数量不能为空")
    @Min(value = 1, message = "题目数量至少为 1")
    @Max(value = 20, message = "题目数量最多为 20")
    private Integer questionCount;

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

}
