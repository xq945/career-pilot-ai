-- ============================================================
-- 智能求职辅助平台 数据库初始化脚本
-- 生成日期：2026-10-09
-- 来源：docs/数据库设计.md（V1.2）
-- 用法：mysql -u root -p < career_pilot_init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS career_pilot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE career_pilot;


-- ============================================================
-- 1. 用户表
-- ============================================================
CREATE TABLE sys_user (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL COMMENT 'BCrypt 哈希，不存明文',
  nickname VARCHAR(50) DEFAULT NULL,
  avatar VARCHAR(500) DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1正常，0禁用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sys_user_username (username),
  UNIQUE KEY uk_sys_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ============================================================
-- 2. 简历表
-- ============================================================
CREATE TABLE resume (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  file_name VARCHAR(255) NOT NULL COMMENT '用户上传时的原始文件名',
  file_type VARCHAR(20) NOT NULL COMMENT 'PDF/DOCX',
  file_path VARCHAR(500) NOT NULL COMMENT '相对 storage-root 的路径，不向前端暴露',
  content LONGTEXT NOT NULL COMMENT '提取的简历文本（入库前按上限截断）',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效，0已删除（逻辑删除）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_resume_user_created (user_id, created_at),
  CONSTRAINT fk_resume_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历表';

-- ============================================================
-- 3. 简历分析结果
-- ============================================================
CREATE TABLE resume_analysis (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  resume_id BIGINT NOT NULL,
  version_no INT NOT NULL DEFAULT 1 COMMENT '同一简历的分析版本号，从 1 递增',
  source_hash VARCHAR(64) DEFAULT NULL COMMENT '分析时简历文本的 SHA-256，数据追溯用',
  summary TEXT,
  skills JSON,
  education JSON,
  projects JSON,
  experience JSON,
  advantages JSON,
  weaknesses JSON,
  suggestions JSON,
  model_name VARCHAR(100) COMMENT '实际调用的模型名',
  status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' COMMENT 'SUCCESS/FAILED',
  error_message VARCHAR(500) DEFAULT NULL COMMENT '仅排查用，不向前端返回',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_resume_analysis_version (resume_id, version_no),
  KEY idx_resume_analysis_hash (resume_id, source_hash),
  CONSTRAINT fk_resume_analysis_resume FOREIGN KEY (resume_id) REFERENCES resume(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历分析结果';

-- ============================================================
-- 4. 目标岗位
-- ============================================================
CREATE TABLE job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  company_name VARCHAR(100) DEFAULT NULL,
  job_name VARCHAR(100) NOT NULL,
  description LONGTEXT NOT NULL,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效，0已删除（逻辑删除）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_job_user_created (user_id, created_at),
  CONSTRAINT fk_job_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='目标岗位';

-- ============================================================
-- 5. 岗位分析结果
-- ============================================================
CREATE TABLE job_analysis (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_id BIGINT NOT NULL,
  version_no INT NOT NULL DEFAULT 1 COMMENT '同一岗位的分析版本号，从 1 递增',
  source_hash VARCHAR(64) DEFAULT NULL COMMENT '分析时岗位描述的 SHA-256，用于判断分析是否过期（stale）',
  responsibilities JSON,
  required_skills JSON,
  preferred_skills JSON,
  education_requirement VARCHAR(255),
  experience_requirement VARCHAR(255),
  technology_stack JSON,
  soft_skills JSON,
  summary TEXT,
  model_name VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' COMMENT 'SUCCESS/FAILED',
  error_message VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_job_analysis_version (job_id, version_no),
  KEY idx_job_analysis_hash (job_id, source_hash),
  CONSTRAINT fk_job_analysis_job FOREIGN KEY (job_id) REFERENCES job(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位分析结果';

-- ============================================================
-- 6. 简历岗位匹配记录
-- ============================================================
CREATE TABLE match_record (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  resume_id BIGINT NOT NULL,
  job_id BIGINT NOT NULL,
  resume_analysis_id BIGINT NOT NULL COMMENT '本次匹配所依据的简历分析版本，业务上必然存在（见 5.8）',
  job_analysis_id BIGINT NOT NULL COMMENT '本次匹配所依据的岗位分析版本，业务上必然存在（见 5.8）',
  match_score DECIMAL(5,2) NOT NULL COMMENT '0.00至100.00，由后端规则计算',
  matched_items JSON,
  partial_items JSON,
  missing_items JSON,
  dimension_scores JSON,
  suggestions JSON,
  summary TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_match_user_created (user_id, created_at),
  KEY idx_match_resume_job (resume_id, job_id),
  KEY idx_match_job (job_id),
  KEY idx_match_resume_analysis (resume_analysis_id),
  KEY idx_match_job_analysis (job_analysis_id),
  CONSTRAINT fk_match_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_resume FOREIGN KEY (resume_id) REFERENCES resume(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_job FOREIGN KEY (job_id) REFERENCES job(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_resume_analysis FOREIGN KEY (resume_analysis_id) REFERENCES resume_analysis(id) ON DELETE RESTRICT,
  CONSTRAINT fk_match_job_analysis FOREIGN KEY (job_analysis_id) REFERENCES job_analysis(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历岗位匹配记录';

-- ============================================================
-- 7. 面试会话
-- ============================================================
CREATE TABLE interview_session (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  job_id BIGINT NOT NULL,
  resume_id BIGINT DEFAULT NULL COMMENT '关联简历（M12：面试出题参考的候选人简历，可空）',
  optimization_id BIGINT DEFAULT NULL COMMENT '关联优化记录（M12：从优化工作台发起时写入，可空）',
  title VARCHAR(100) NOT NULL,
  question_type VARCHAR(30) NOT NULL DEFAULT 'MIXED' COMMENT 'JAVA/SPRING/MYSQL/REDIS/PROJECT/MIXED',
  question_count INT NOT NULL DEFAULT 5 COMMENT '计划题目数，创建会话时确定',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0进行中，1已完成，2已取消',
  total_score DECIMAL(5,2) DEFAULT NULL COMMENT '全部作答完成后计算',
  overall_summary TEXT DEFAULT NULL COMMENT 'AI 总评，会话完成时写入（M7）',
  strengths JSON DEFAULT NULL COMMENT 'AI 归纳的强项标签（M7）',
  weaknesses JSON DEFAULT NULL COMMENT 'AI 归纳的薄弱标签（M7）',
  recommendations JSON DEFAULT NULL COMMENT 'AI 归纳的提升建议（M7）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  KEY idx_interview_user_created (user_id, created_at),
  KEY idx_interview_job (job_id),
  KEY idx_interview_resume (resume_id),
  KEY idx_interview_optimization (optimization_id),
  CONSTRAINT fk_interview_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_interview_job FOREIGN KEY (job_id) REFERENCES job(id) ON DELETE RESTRICT,
  CONSTRAINT fk_interview_resume FOREIGN KEY (resume_id) REFERENCES resume(id) ON DELETE RESTRICT,
  CONSTRAINT fk_interview_optimization FOREIGN KEY (optimization_id) REFERENCES resume_optimization(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='面试会话';

-- V1.4 增量（既有库升级执行；新建库执行上面的完整 DDL 即可）：
-- ALTER TABLE interview_session
--   ADD COLUMN overall_summary TEXT NULL COMMENT 'AI 总评，会话完成时写入（M7）',
--   ADD COLUMN strengths JSON NULL COMMENT 'AI 归纳的强项标签（M7）',
--   ADD COLUMN weaknesses JSON NULL COMMENT 'AI 归纳的薄弱标签（M7）',
--   ADD COLUMN recommendations JSON NULL COMMENT 'AI 归纳的提升建议（M7）';

-- V1.7 增量（M12，既有库升级执行；新建库执行上面的完整 DDL 即可）：
-- ALTER TABLE interview_session
--   ADD COLUMN resume_id BIGINT DEFAULT NULL COMMENT '关联简历（M12）',
--   ADD COLUMN optimization_id BIGINT DEFAULT NULL COMMENT '关联优化记录（M12）',
--   ADD KEY idx_interview_resume (resume_id),
--   ADD KEY idx_interview_optimization (optimization_id),
--   ADD CONSTRAINT fk_interview_resume FOREIGN KEY (resume_id) REFERENCES resume(id) ON DELETE RESTRICT,
--   ADD CONSTRAINT fk_interview_optimization FOREIGN KEY (optimization_id) REFERENCES resume_optimization(id) ON DELETE RESTRICT;

-- ============================================================
-- 8. 面试题与回答
-- ============================================================
CREATE TABLE interview_question (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id BIGINT NOT NULL,
  question TEXT NOT NULL,
  question_category VARCHAR(50) DEFAULT NULL,
  answer TEXT COMMENT '用户回答，未作答为 NULL',
  reference_answer TEXT,
  score DECIMAL(5,2) DEFAULT NULL,
  analysis TEXT,
  suggestions JSON,
  sort_order INT NOT NULL DEFAULT 1 COMMENT '题目顺序，同一会话内唯一',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_interview_question_order (session_id, sort_order),
  CONSTRAINT fk_interview_question_session FOREIGN KEY (session_id) REFERENCES interview_session(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='面试题与回答';

-- ============================================================
-- 9. 智能体会话
-- ============================================================
CREATE TABLE agent_session (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  session_id VARCHAR(64) NOT NULL COMMENT '应用层生成的会话标识（UUID）',
  title VARCHAR(100) NOT NULL COMMENT '会话标题，取首条用户消息的前若干字符',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '会话列表排序依据；写入新消息时须由应用层显式更新（见 5.9）',
  UNIQUE KEY uk_agent_session_sid (session_id),
  KEY idx_agent_session_user (user_id, updated_at),
  CONSTRAINT fk_agent_session_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='智能体会话';

-- ============================================================
-- 10. 智能体对话与工具调用记录
-- ============================================================
CREATE TABLE agent_chat_message (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  session_id VARCHAR(64) NOT NULL COMMENT '关联 agent_session.session_id',
  role VARCHAR(20) NOT NULL COMMENT 'user/assistant/tool',
  content LONGTEXT,
  tool_name VARCHAR(100) DEFAULT NULL COMMENT 'role=tool 时记录工具名',
  tool_arguments JSON DEFAULT NULL COMMENT 'role=tool 时记录入参',
  tool_result JSON DEFAULT NULL COMMENT 'role=tool 时记录（脱敏后的）结果摘要',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_agent_session_created (user_id, session_id, created_at),
  KEY idx_agent_message_session (session_id),
  CONSTRAINT fk_agent_message_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_agent_message_session FOREIGN KEY (session_id) REFERENCES agent_session(session_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='智能体对话与工具调用记录';

-- ============================================================
-- 11. 简历定向优化记录（V1.6 新增，M11）
-- ============================================================
CREATE TABLE resume_optimization (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  resume_id BIGINT NOT NULL,
  job_id BIGINT NOT NULL,
  match_record_id BIGINT NOT NULL COMMENT '优化前匹配评估（复用 match_record，含明细与维度分）',
  version_no INT NOT NULL DEFAULT 1 COMMENT '同一简历+岗位的优化版本号，从 1 递增',
  optimized_content LONGTEXT COMMENT '模型输出的优化后简历（Markdown 原稿，不可变，见《数据库设计》5.11）',
  changes JSON COMMENT '逐项修改说明 [{section,type,reason,before,after}]',
  gap_questions JSON COMMENT '待用户确认的问题（简历中缺失的事实，不由模型补全）',
  edited_content LONGTEXT DEFAULT NULL COMMENT '用户编辑后的当前稿（不覆盖 optimized_content）',
  edit_history JSON DEFAULT NULL COMMENT '编辑历史快照 [{content,savedAt}]，最多保留 10 版',
  score_after DECIMAL(5,2) DEFAULT NULL COMMENT '优化后匹配总分（重新评估后写入，0.00–100.00）',
  dimension_scores_after JSON DEFAULT NULL COMMENT '优化后维度得分（结构同 match_record.dimension_scores）',
  optimized_analysis JSON DEFAULT NULL COMMENT '优化稿的结构化分析（评估依据，追溯用）',
  evaluated_at DATETIME DEFAULT NULL COMMENT '最近一次评估时间',
  model_name VARCHAR(100) COMMENT '实际调用的模型名',
  status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' COMMENT 'SUCCESS/FAILED',
  error_message VARCHAR(500) DEFAULT NULL COMMENT '仅排查用，不向前端返回',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '编辑保存/评估后须由应用层显式更新',
  UNIQUE KEY uk_resume_optimization_version (resume_id, job_id, version_no),
  KEY idx_resume_optimization_user_created (user_id, created_at),
  KEY idx_resume_optimization_job (job_id),
  KEY idx_resume_optimization_match (match_record_id),
  CONSTRAINT fk_resume_optimization_user FOREIGN KEY (user_id) REFERENCES sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT fk_resume_optimization_resume FOREIGN KEY (resume_id) REFERENCES resume(id) ON DELETE RESTRICT,
  CONSTRAINT fk_resume_optimization_job FOREIGN KEY (job_id) REFERENCES job(id) ON DELETE RESTRICT,
  CONSTRAINT fk_resume_optimization_match FOREIGN KEY (match_record_id) REFERENCES match_record(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历定向优化记录';

-- V1.6 增量（既有库升级执行；新建库执行上面的完整 DDL 即可）：
-- 该表为 V1.6 全新新增、无列级变更，把上面的 CREATE TABLE resume_optimization 整段执行一次即可。
