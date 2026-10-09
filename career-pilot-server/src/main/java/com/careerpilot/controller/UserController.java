package com.careerpilot.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.careerpilot.common.ApiResponse;
import com.careerpilot.dto.UserProfile;
import com.careerpilot.security.CurrentUser;
import com.careerpilot.service.AuthService;

/**
 * 用户接口（《API接口设计》3.3）。
 *
 * 用户身份一律取自认证上下文，不接受前端传入的 userId。
 */
@RestController
@RequestMapping("/api/user")
public class UserController {

    private final AuthService authService;

    public UserController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/profile")
    public ApiResponse<UserProfile> profile() {
        return ApiResponse.success(authService.getProfile(CurrentUser.requireId()));
    }

}
