package com.careerpilot.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import com.careerpilot.common.BusinessException;

/**
 * 当前登录用户上下文。
 *
 * **用户身份只能从这里获取** —— Service 与 Tool 一律不得接受前端或模型传入的 userId
 * （《系统架构设计》4.1、7 节；《Agent设计》4.1）。
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static AuthenticatedUser require() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser user)) {
            throw BusinessException.unauthorized("未登录或登录已过期");
        }
        return user;
    }

    public static Long requireId() {
        return require().id();
    }

}
