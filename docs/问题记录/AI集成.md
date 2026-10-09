# AI 集成问题记录

- 记录日期：2026-10-09
- 状态：持续更新

**本文件收纳范围**：Spring AI 与 DeepSeek 的接入方式、配置属性、API 用法等。

> 归档约定：`docs/问题记录/` 下按问题类别分文件收纳实施过程中**实际遇到的问题**。
> 同类问题追加到本文件；不同类别的问题另建文件（如 `构建与依赖.md`、`配置与启动.md`）。

---

## 1. `ChatClientRequestSpec.options()` 接收的是 Builder 而非 options 实例

### 现象

编译失败：

```text
无法将接口 ChatClient.ChatClientRequestSpec 中的方法 options 应用到给定类型;
  需要: B
  找到: org.springframework.ai.deepseek.DeepSeekChatOptions
  原因: 推断变量 B 具有不兼容的上限
```

### 根因

Spring AI 2.0.1 中该方法的签名为：

```java
<B extends ChatOptions$Builder<?>> ChatClientRequestSpec options(B);
```

参数是 **Builder**，而非构造好的 options 对象。

### 解法

传入 builder 本身，**不要调用 `.build()`**：

```java
chatClient.prompt()
    .options(DeepSeekChatOptions.builder().temperature(0.5))
    .user(question)
    .call()
    .content();
```

### 经验

网上的 `ChatClient` 示例多写于 Spring AI 1.0 时期，`.options(chatOptions)` 的写法在 2.0 上不适用。遇到方法签名类问题，直接反编译本地 jar 是最高效的确认手段：

```bash
javap -cp <jar> 'org.springframework.ai.chat.client.ChatClient$ChatClientRequestSpec'
```

---

## 2. `spring.ai.deepseek.chat.options.thinking` 是已废弃路径

### 现象

按《Agent设计》7.1 节的配置示例设置思考模式 —— 该示例用的是废弃路径。

### 根因

Spring AI 2.0.1 的配置元数据中，`spring.ai.deepseek.chat.options.thinking` 带有：

```json
"deprecation": { "replacement": "spring.ai.deepseek.chat.thinking" }
```

即 **`thinking` 位于 `chat` 下、与 `options` 平级**，不在 `options` 内部。

### 解法

```yaml
spring:
  ai:
    deepseek:
      chat:
        thinking:
          type: disabled        # 正确路径
        options:
          model: deepseek-flash
          temperature: 0.3
```

《Agent设计》7.1 节的示例已同步修正。

### 经验

**配置属性名以 jar 内 `META-INF/spring-configuration-metadata.json` 为准**，它同时记录属性类型与废弃信息：

```bash
unzip -p <jar> META-INF/spring-configuration-metadata.json | tr '{' '\n' | grep -i thinking
```

凡是 `chat.*` 与 `chat.options.*` 重复出现的属性（`model`、`temperature`、`thinking` 等），都要先确认哪个是当前写法。

---

## 3. `DeepSeekApi.ChatModel` 枚举里的模型名是旧名

### 现象

若用代码以枚举指定模型（`DeepSeekChatOptions.builder().model(...)`），会发现枚举中没有 `deepseek-flash`。

### 根因

该枚举取值为：

```text
DEEPSEEK_V4_FLASH / DEEPSEEK_V4_PRO / DEEPSEEK_CHAT / DEEPSEEK_REASONER
```

其中 `DEEPSEEK_CHAT`、`DEEPSEEK_REASONER` 对应的模型名已从 DeepSeek 官方模型表退役（见《Agent设计》7.3 节）—— **Spring AI 的枚举未随官方更名同步**。

### 解法

**模型名通过配置文件以字符串指定**，已验证可用：

```yaml
spring:
  ai:
    deepseek:
      chat:
        options:
          model: deepseek-flash
```

不要依赖枚举，也不要依赖 Spring AI 的默认模型名。

### 经验

Spring AI 的类型定义相对服务商官方存在滞后。凡涉及**服务商侧**的取值（模型名、参数名、参数取值），一律以服务商官方文档为准，框架内的枚举与默认值仅作参考。
