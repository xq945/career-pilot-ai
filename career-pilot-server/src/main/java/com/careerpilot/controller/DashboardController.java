package com.careerpilot.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.careerpilot.common.ApiResponse;
import com.careerpilot.dto.DashboardSummary;
import com.careerpilot.security.CurrentUser;
import com.careerpilot.service.DashboardService;

/**
 * 仪表盘接口（《API接口设计》9.1）。
 *
 * <p>用户身份一律取自认证上下文，不接受前端传入的 userId（《系统架构设计》4.1）；
 * 只读、只服务仪表盘单一页面——前端整页**只发这一个请求**，准备清单的完成状态
 * 由返回的计数字段推导（《前端原型设计》5.2）。
 */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    /** 汇总数据（9.1）：四类计数 + 最近匹配（5 条）+ 能力差距（最多 3 条），一次装配返回 */
    @GetMapping("/summary")
    public ApiResponse<DashboardSummary> summary() {
        return ApiResponse.success(dashboardService.summary(CurrentUser.requireId()));
    }

}
