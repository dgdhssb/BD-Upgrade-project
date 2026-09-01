package com.example.bd3.common.exception;

/**
 * 业务异常。
 * 由原官方公共包 {@code com.winston.api.exception.BusinessException} 迁移至本仓库
 * （com.example.bd3.common.exception），版本由本仓库 BOM 统一管理。
 */
public class BusinessException extends RuntimeException {

    private final int code;

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }

    public BusinessException(String message) {
        super(message);
        this.code = 40001;
    }

    public int getCode() {
        return code;
    }
}
