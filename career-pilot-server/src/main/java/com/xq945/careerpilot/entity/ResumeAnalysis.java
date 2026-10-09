package com.xq945.careerpilot.entity;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.Jackson3TypeHandler;

/**
 * 简历分析结果。
 *
 * JSON 列的处理方式见《数据库设计》5.5 节：
 * 使用 MyBatis-Plus 的 JSON TypeHandler，并在 @TableName 上开启 autoResultMap，
 * 否则查询时不会走 TypeHandler（这是 MyBatis-Plus 的常见坑）。
 *
 * Spring Boot 4 环境下使用 Jackson3TypeHandler（对应 tools.jackson 包）。
 */
@TableName(value = "resume_analysis", autoResultMap = true)
public class ResumeAnalysis {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long resumeId;

    private Integer versionNo;

    private String sourceHash;

    private String summary;

    /** 对象数组：技能项（含 name / level / evidence） */
    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<Map<String, Object>> skills;

    /** 字符串数组：改进建议 */
    @TableField(typeHandler = Jackson3TypeHandler.class)
    private List<String> suggestions;

    private String modelName;

    private String status;

    private String errorMessage;

    private LocalDateTime createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getResumeId() {
        return resumeId;
    }

    public void setResumeId(Long resumeId) {
        this.resumeId = resumeId;
    }

    public Integer getVersionNo() {
        return versionNo;
    }

    public void setVersionNo(Integer versionNo) {
        this.versionNo = versionNo;
    }

    public String getSourceHash() {
        return sourceHash;
    }

    public void setSourceHash(String sourceHash) {
        this.sourceHash = sourceHash;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public List<Map<String, Object>> getSkills() {
        return skills;
    }

    public void setSkills(List<Map<String, Object>> skills) {
        this.skills = skills;
    }

    public List<String> getSuggestions() {
        return suggestions;
    }

    public void setSuggestions(List<String> suggestions) {
        this.suggestions = suggestions;
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

}
