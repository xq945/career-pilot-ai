package com.careerpilot.ai;

/**
 * 一次成功的模型调用结果：结构化输出 + 成本核算元数据（《Agent设计》8 节）。
 *
 * token 字段可能为 null（上游未返回 usage），使用方须判空。
 */
public record AiCallResult<T>(
        T value,
        String modelName,
        long elapsedMillis,
        Integer promptTokens,
        Integer completionTokens,
        Integer totalTokens) {
}
