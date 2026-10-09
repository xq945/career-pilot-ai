package com.careerpilot.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 登录请求（《API接口设计》3.2）。
 */
public class LoginRequest {

    /** 用户名或邮箱 */
    @NotBlank(message = "账号不能为空")
    private String account;

    @NotBlank(message = "密码不能为空")
    private String password;

    public String getAccount() {
        return account;
    }

    public void setAccount(String account) {
        this.account = account;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

}
