package com.careerpilot.service;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.careerpilot.common.BusinessException;
import com.careerpilot.dto.LoginRequest;
import com.careerpilot.dto.LoginResponse;
import com.careerpilot.dto.RegisterRequest;
import com.careerpilot.dto.UserProfile;
import com.careerpilot.entity.SysUser;
import com.careerpilot.mapper.SysUserMapper;
import com.careerpilot.security.JwtTokenProvider;

/**
 * 认证与用户服务（《API接口设计》3 节）。
 */
@Service
public class AuthService {

    private static final int STATUS_ENABLED = 1;

    private final SysUserMapper userMapper;

    private final PasswordEncoder passwordEncoder;

    private final JwtTokenProvider tokenProvider;

    public AuthService(SysUserMapper userMapper, PasswordEncoder passwordEncoder,
                       JwtTokenProvider tokenProvider) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
        this.tokenProvider = tokenProvider;
    }

    /** 注册：用户名与邮箱唯一，密码以 BCrypt 哈希保存 */
    @Transactional
    public UserProfile register(RegisterRequest request) {
        Long usernameCount = userMapper.selectCount(
                Wrappers.<SysUser>lambdaQuery().eq(SysUser::getUsername, request.getUsername()));
        if (usernameCount != null && usernameCount > 0) {
            throw BusinessException.badRequest("用户名已被占用");
        }

        Long emailCount = userMapper.selectCount(
                Wrappers.<SysUser>lambdaQuery().eq(SysUser::getEmail, request.getEmail()));
        if (emailCount != null && emailCount > 0) {
            throw BusinessException.badRequest("该邮箱已被注册");
        }

        SysUser user = new SysUser();
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNickname(request.getUsername());
        user.setStatus(STATUS_ENABLED);
        userMapper.insert(user);

        return UserProfile.from(user);
    }

    /** 登录：账号可为用户名或邮箱 */
    public LoginResponse login(LoginRequest request) {
        SysUser user = userMapper.selectOne(Wrappers.<SysUser>lambdaQuery()
                .eq(SysUser::getUsername, request.getAccount())
                .or()
                .eq(SysUser::getEmail, request.getAccount()));

        // 账号不存在与密码错误返回同一提示，避免暴露账号是否注册
        if (user == null || !passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw BusinessException.unauthorized("账号或密码错误");
        }
        if (user.getStatus() == null || user.getStatus() != STATUS_ENABLED) {
            throw BusinessException.forbidden("账号已被禁用");
        }

        LoginResponse response = new LoginResponse();
        response.setToken(tokenProvider.generateToken(user.getId(), user.getUsername()));
        response.setExpiresIn(tokenProvider.getExpirationSeconds());
        response.setUser(UserProfile.from(user));
        return response;
    }

    /** 读取当前用户资料 */
    public UserProfile getProfile(Long userId) {
        SysUser user = userMapper.selectById(userId);
        if (user == null) {
            throw BusinessException.notFound("用户不存在");
        }
        return UserProfile.from(user);
    }

}
