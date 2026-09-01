package com.example.bd3.common.model;

/**
 * 项目级错误码。
 * 基线码（SUCCESS / PARAM_ERROR / NOT_LOGIN / NO_PERMISSION / DATA_NOT_FOUND /
 * BUSINESS_ERROR / SYSTEM_ERROR）原来自官方公共包 com.winston.api.exception.ErrorCode，
 * 已合并进本接口（数值保持一致），；本接口补充本系统特有的业务错误码。
 * 各模块统一引用本接口即可获得全部错误码，避免与文档规定的统一响应模型脱节。
 */
public interface ErrorCode {

    // ===== 基线错误码（原官方公共包，数值保持一致） =====
    int SUCCESS = 0;
    int PARAM_ERROR = 10001;
    int NOT_LOGIN = 20001;
    int NO_PERMISSION = 20002;
    int DATA_NOT_FOUND = 30001;
    int BUSINESS_ERROR = 40001;
    int SYSTEM_ERROR = 50000;

    // ===== 本系统补充错误码 =====

    // 参数相关 (10001~19999)
    int PARAM_MISSING = 10002;

    // 认证授权 (20001~29999)
    int TOKEN_EXPIRED = 20003;

    // 数据相关 (30001~39999)
    int DATA_ALREADY_EXISTS = 30002;
    int DATA_OPERATION_FAILED = 30003;

    // 业务逻辑 (40001~49999)
    int ARCHIVE_FAILED = 40002;
    int RESTORE_FAILED = 40003;

    // 系统级 (50000~59999)
    int DB_ERROR = 50001;
}
