package com.careerpilot.service;

import java.io.IOException;
import java.io.InputStream;

import org.apache.tika.exception.TikaException;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.metadata.TikaCoreProperties;
import org.apache.tika.parser.AutoDetectParser;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.sax.BodyContentHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.xml.sax.SAXException;

import com.careerpilot.common.BusinessException;

/**
 * 文件文本提取（《系统架构设计》6.1、《API接口设计》4.1）。
 *
 * 用 Tika 的 AutoDetectParser 按内容自动选择解析器。提取失败、结果为空或过短
 * 一律视为"文件不含可复制文本"，返回 400——不产生半成品记录（上传整体失败）。
 *
 * 提取文本的上限截断在此统一完成：入库文本即"截断后的文本"，
 * 后续 AI 分析的 source_hash 必须基于**同一份截断文本**计算（《数据库设计》5.2）。
 */
@Service
public class TextExtractionService {

    private static final Logger log = LoggerFactory.getLogger(TextExtractionService.class);

    /** 提取文本入库上限（《API接口设计》§10、数据库设计 5.2） */
    public static final int MAX_CONTENT_LENGTH = 20000;

    /**
     * "过短"的判定阈值。设计文档只说"为空/过短"未给具体值（M3 实现时定），
     * 取 50：正常简历不可能只有几十个字符，低于此值基本是扫描件/图片/损坏文件。
     */
    private static final int MIN_CONTENT_LENGTH = 50;

    private static final String EXTRACT_FAILED_MESSAGE =
            "未能从文件中提取文字，请确认文件包含可复制的文本（扫描件与纯图片暂不支持）";

    /**
     * AutoDetectParser 线程安全（内部解析器注册表只读），可复用单例；
     * 每个请求各自创建 Metadata / ParseContext / ContentHandler。
     */
    private final AutoDetectParser parser = new AutoDetectParser();

    /**
     * 提取并截断文本；失败/为空/过短抛 400/40000。
     *
     * @param file 已通过三重校验的上传文件
     * @return 截断至 {@link #MAX_CONTENT_LENGTH} 的提取文本（已 strip）
     */
    public String extract(MultipartFile file) {
        String text;
        try (InputStream in = file.getInputStream()) {
            // writeLimit = -1：不限制长度，上限截断由本方法统一负责
            // （默认构造只保留前 100 KB，会与 20000 字符上限的语义纠缠不清）
            BodyContentHandler handler = new BodyContentHandler(-1);
            Metadata metadata = new Metadata();
            // 文件名参与类型探测；与"扩展名/MIME/内容特征"三重校验相互独立
            metadata.set(TikaCoreProperties.RESOURCE_NAME_KEY, file.getOriginalFilename());
            parser.parse(in, handler, metadata, new ParseContext());
            text = handler.toString();
        }
        catch (IOException | SAXException | TikaException ex) {
            // 不记录文件内容，只记异常摘要（《系统架构设计》7.7 日志脱敏）
            log.warn("文本提取失败：{}", ex.getMessage());
            throw BusinessException.badRequest(EXTRACT_FAILED_MESSAGE);
        }

        String trimmed = text == null ? "" : text.strip();
        if (trimmed.length() < MIN_CONTENT_LENGTH) {
            log.warn("提取文本为空或过短（{} 字符），拒绝入库", trimmed.length());
            throw BusinessException.badRequest(EXTRACT_FAILED_MESSAGE);
        }
        return trimmed.length() > MAX_CONTENT_LENGTH
                ? trimmed.substring(0, MAX_CONTENT_LENGTH)
                : trimmed;
    }

}
