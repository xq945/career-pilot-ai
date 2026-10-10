package com.careerpilot.entity;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 目标岗位实体，对应《数据库设计》中的 job。
 *
 * 逻辑删除约定（《数据库设计》5.4，R07）：**手写 status 条件，不用 @TableLogic**——
 * 查询自行附加 {@code status = 1}、删除写 {@code status = 0}。
 *
 * 与简历的区别：岗位是**手输文本**（description），没有文件；且**支持更新**——
 * 描述变更后其 SHA-256 与最新成功分析的 source_hash 不再一致，即分析「已过期」（stale），
 * 这是本项目唯一存在分析过期场景的资源（《API接口设计》5.2）。
 */
@TableName("job")
public class Job {

    public static final int STATUS_ACTIVE = 1;

    public static final int STATUS_DELETED = 0;

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private String companyName;

    private String jobName;

    /** 岗位职责与任职要求的完整文本（粘贴 JD 原文，≤ 10000 字符） */
    private String description;

    /** 1 有效，0 已删除 */
    private Integer status;

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

    public String getCompanyName() {
        return companyName;
    }

    public void setCompanyName(String companyName) {
        this.companyName = companyName;
    }

    public String getJobName() {
        return jobName;
    }

    public void setJobName(String jobName) {
        this.jobName = jobName;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
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
