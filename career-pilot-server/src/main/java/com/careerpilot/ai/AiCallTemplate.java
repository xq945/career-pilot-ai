package com.careerpilot.ai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.ResponseEntity;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.stereotype.Component;

import com.careerpilot.common.BusinessException;

import tools.jackson.core.JacksonException;

/**
 * AI 调用的统一入口（M4 定死的范式，M5–M8 直接复用；全项目唯一与模型对话的地方）。
 *
 * 职责：
 * - 拼装消息 → 结构化输出调用（{@code .entity()} 族）→ 计时 → 结果与元数据；
 * - 框架异常统一翻译为业务错误码：**输出无法解析 → 50201；其余 → 50200**
 *   （超时、网络故障、上游 HTTP 错误、重试耗尽——默认重试次数由
 *   {@code spring.ai.retry.max-attempts} 控制在 2 次，见 application.yml）；
 * - 成功日志记录模型名、耗时、token 消耗（《Agent设计》8 节成本核算）；
 *   失败日志只记异常类型与截断后的消息摘要，**绝不记录提示词、简历原文与 API Key**
 *   （《系统架构设计》7 节第 7 条、《Agent设计》8 节）。
 *
 * 超时与重试不在此实现：超时由 {@code spring.http.clients.*} 注入底层 RestClient，
 * 重试由 {@code spring.ai.retry.*} 配置的 RetryTemplate 承担。
 */
@Component
public class AiCallTemplate {

    private static final Logger log = LoggerFactory.getLogger(AiCallTemplate.class);

    private static final String UNAVAILABLE_MESSAGE = "大模型服务暂时不可用，请稍后重试";

    private static final String UNPARSABLE_MESSAGE = "大模型输出无法解析，请稍后重试";

    /** 失败日志中异常消息的截断长度（脱敏与可读性的折中） */
    private static final int ERROR_DETAIL_LIMIT = 200;

    private final ChatClient chatClient;

    public AiCallTemplate(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    /**
     * 结构化输出调用。
     *
     * @param scene        场景名（日志与清洗日志用，如 resume-analysis）
     * @param systemPrompt 系统提示词
     * @param userPrompt   用户消息（含待分析文本）
     * @param outputType   结构化输出类型（由 Spring AI 的 BeanOutputConverter 反序列化，
     *                     JSON Schema 会自动注入提示词）
     */
    public <T> AiCallResult<T> call(String scene, String systemPrompt, String userPrompt,
                                    Class<T> outputType) {
        // 【关键约束】绝不使用 .param(...) / .user(text, map)：
        // 一旦传入参数，Spring AI 会用 StringTemplate 渲染整段文本，
        // 提示词里的 JSON 结构示例与简历原文中的花括号会被当成模板变量而报错
        // （《问题记录 · AI集成》）。此处 system 与 user 均为最终文本。
        long startNanos = System.nanoTime();
        ResponseEntity<ChatResponse, T> response;
        try {
            response = chatClient.prompt()
                    .system(systemPrompt)
                    .user(userPrompt)
                    .call()
                    .responseEntity(outputType);
        }
        catch (BusinessException ex) {
            throw ex;
        }
        catch (RuntimeException ex) {
            throw translate(scene, ex, startNanos);
        }

        long elapsedMillis = elapsedMillis(startNanos);
        T value = response.entity();
        if (value == null) {
            // 输出为空（模型未返回可解析内容）：按「输出无法解析」处理，不落库
            log.warn("AI 输出为空：scene={} 耗时={}ms", scene, elapsedMillis);
            throw BusinessException.aiInvalidOutput(UNPARSABLE_MESSAGE);
        }

        ChatResponse chatResponse = response.response();
        String modelName = resolveModelName(chatResponse);
        Usage usage = usageOf(chatResponse);
        Integer promptTokens = usage == null ? null : usage.getPromptTokens();
        Integer completionTokens = usage == null ? null : usage.getCompletionTokens();
        Integer totalTokens = usage == null ? null : usage.getTotalTokens();

        log.info("AI 调用完成：scene={} model={} 耗时={}ms promptTokens={} completionTokens={} totalTokens={}",
                scene, modelName, elapsedMillis, promptTokens, completionTokens, totalTokens);
        return new AiCallResult<>(response.entity(), modelName, elapsedMillis,
                promptTokens, completionTokens, totalTokens);
    }

    // ---------------------------------------------------------------- 异常翻译

    /**
     * 统一翻译为 502 系列。（《Agent设计》6.4：反序列化失败 → 50201；
     * 超时/不可用 → 50200。）
     *
     * 判定走**异常链根因**：重试耗尽后抛出的可能是框架的包装异常
     * （Spring Framework 7 的 RetryException 等），顶层类型未必是原始异常。
     */
    private BusinessException translate(String scene, RuntimeException ex, long startNanos) {
        long elapsedMillis = elapsedMillis(startNanos);
        if (hasCause(ex, JacksonException.class)) {
            log.warn("AI 输出无法解析：scene={} 耗时={}ms 异常={} 摘要={}",
                    scene, elapsedMillis, ex.getClass().getSimpleName(), detailOf(ex));
            return BusinessException.aiInvalidOutput(UNPARSABLE_MESSAGE);
        }
        log.warn("AI 调用失败：scene={} 耗时={}ms 异常={} 摘要={}",
                scene, elapsedMillis, ex.getClass().getSimpleName(), detailOf(ex));
        return BusinessException.aiUnavailable(UNAVAILABLE_MESSAGE);
    }

    private static boolean hasCause(Throwable ex, Class<? extends Throwable> type) {
        for (Throwable current = ex; current != null; current = current.getCause()) {
            if (type.isInstance(current)) {
                return true;
            }
            if (current.getCause() == current) {
                break;
            }
        }
        return false;
    }

    /** 异常消息的短摘要：折断换行并截断（防止把长响应体原样写进日志） */
    private static String detailOf(Throwable ex) {
        String message = ex.getMessage();
        if (message == null || message.isBlank()) {
            return "(无消息)";
        }
        String flat = message.replaceAll("\\s+", " ").trim();
        return flat.length() > ERROR_DETAIL_LIMIT ? flat.substring(0, ERROR_DETAIL_LIMIT) + "…" : flat;
    }

    // ---------------------------------------------------------------- 元数据

    private static String resolveModelName(ChatResponse chatResponse) {
        ChatResponseMetadata metadata = chatResponse == null ? null : chatResponse.getMetadata();
        String model = metadata == null ? null : metadata.getModel();
        if (model == null || model.isBlank()) {
            log.warn("模型响应未返回 model 字段，modelName 记为 unknown");
            return "unknown";
        }
        return model;
    }

    private static Usage usageOf(ChatResponse chatResponse) {
        ChatResponseMetadata metadata = chatResponse == null ? null : chatResponse.getMetadata();
        return metadata == null ? null : metadata.getUsage();
    }

    private static long elapsedMillis(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000L;
    }

}
