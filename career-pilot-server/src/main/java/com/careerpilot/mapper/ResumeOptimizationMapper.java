package com.careerpilot.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.careerpilot.entity.ResumeOptimization;

/**
 * 简历定向优化记录 Mapper（对应《数据库设计》第 11 张表）。
 * 全部查询由 Service 以 LambdaQuery 构造（无自定义 SQL，与既有 mapper 一致）。
 */
@Mapper
public interface ResumeOptimizationMapper extends BaseMapper<ResumeOptimization> {
}
