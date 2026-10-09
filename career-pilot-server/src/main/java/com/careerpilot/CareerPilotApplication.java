package com.careerpilot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;

/**
 * 智能求职辅助平台后端服务启动类。
 *
 * 排除 {@code UserDetailsServiceAutoConfiguration}：本项目认证完全基于 JWT 过滤器，
 * 不使用 Spring Security 的 UserDetailsService。若不排除，启动时会自动装配一个内存用户
 * 并打印 "Using generated security password" 警告，既无用处又容易造成误解。
 */
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class CareerPilotApplication {

    public static void main(String[] args) {
        SpringApplication.run(CareerPilotApplication.class, args);
    }

}
