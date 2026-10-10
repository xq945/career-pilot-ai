package com.careerpilot.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 创建 / 更新岗位的请求体（《API接口设计》5.1、5.4）。
 *
 * 创建与更新**共用同一结构**：更新是全量更新语义——`jobName` 与 `description`
 * 必须提交且校验同创建，不存在"省略字段即保留原值"的部分更新行为；
 * `companyName` 省略或传 `null` 一律表示清空（不保留原值）。
 *
 * 长度上限对应库列（《API接口设计》10.5）：company_name/job_name VARCHAR(100)、
 * description LONGTEXT（业务上限 10000）。
 */
public class JobSaveRequest {

    @Size(max = 100, message = "公司名称不能超过 100 个字符")
    private String companyName;

    @NotBlank(message = "岗位名称不能为空")
    @Size(max = 100, message = "岗位名称不能超过 100 个字符")
    private String jobName;

    @NotBlank(message = "岗位描述不能为空")
    @Size(max = 10000, message = "岗位描述不能超过 10000 个字符")
    private String description;

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

}
