package com.careerpilot.common;

/**
 * 业务异常：同时携带业务错误码与 HTTP 状态码。
 *
 * 业务码定义见《API接口设计》第 1 节，避免在业务代码中散落魔法数字。
 */
public class BusinessException extends RuntimeException {

    private final int code;

    private final int httpStatus;

    public BusinessException(int code, int httpStatus, String message) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }

    /** 400 / 40000 通用参数错误 */
    public static BusinessException badRequest(String message) {
        return new BusinessException(40000, 400, message);
    }

    /** 401 / 40100 未登录或 Token 无效 */
    public static BusinessException unauthorized(String message) {
        return new BusinessException(40100, 401, message);
    }

    /**
     * 403 / 40300 账号状态受限（当前仅用于"登录时账号已被禁用"）。
     *
     * **资源级越权不要用本方法**——归属校验失败一律 404（不区分"不存在"与"无权访问"，
     * 避免暴露资源存在性，见《API接口设计》§1/A01）；Security 层的授权失败出口同理
     * （见 SecurityConfig 的 accessDeniedHandler）。
     */
    public static BusinessException forbidden(String message) {
        return new BusinessException(40300, 403, message);
    }

    /** 404 / 40400 资源不存在 */
    public static BusinessException notFound(String message) {
        return new BusinessException(40400, 404, message);
    }

    /** 413 / 41300 文件过大 */
    public static BusinessException payloadTooLarge(String message) {
        return new BusinessException(41300, 413, message);
    }

    /** 415 / 41500 文件类型不支持 */
    public static BusinessException unsupportedMediaType(String message) {
        return new BusinessException(41500, 415, message);
    }

    public int getCode() {
        return code;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

}
