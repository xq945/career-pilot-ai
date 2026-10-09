package com.careerpilot.dto;

import com.careerpilot.entity.SysUser;

/**
 * 用户资料，用于登录响应与当前用户接口（《API接口设计》3.3）。
 *
 * 作为对外视图，**不包含密码**。
 */
public class UserProfile {

    private Long id;

    private String username;

    private String email;

    private String nickname;

    private String avatar;

    public static UserProfile from(SysUser user) {
        UserProfile profile = new UserProfile();
        profile.id = user.getId();
        profile.username = user.getUsername();
        profile.email = user.getEmail();
        profile.nickname = user.getNickname();
        profile.avatar = user.getAvatar();
        return profile;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public String getAvatar() {
        return avatar;
    }

    public void setAvatar(String avatar) {
        this.avatar = avatar;
    }

}
