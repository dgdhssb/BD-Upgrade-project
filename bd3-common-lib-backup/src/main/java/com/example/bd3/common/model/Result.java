package com.example.bd3.common.model;

/**
 * 统一响应模型。
 * 由原官方公共包 {@code com.winston.api.model.Result} 迁移至本仓库
 * （com.example.bd3.common.model），版本由本仓库 BOM 统一管理，
 * 消除 ssm-common-api 这一冗余层。
 */
public class Result<T> {

    public static final int SUCCESS = 0;

    private int code;
    private String msg;
    private T data;
    private Long timestamp;

    public Result() {
    }

    public Result(int code, String msg) {
        this.code = code;
        this.msg = msg;
    }

    public static <T> Result<T> success() {
        return new Result<T>().setCode(SUCCESS);
    }

    public static <T> Result<T> success(T data) {
        Result<T> r = new Result<>();
        r.setCode(SUCCESS);
        r.setData(data);
        return r;
    }

    public static <T> Result<T> error(int code, String msg) {
        return new Result<T>().setCode(code).setMsg(msg);
    }

    public int getCode() {
        return code;
    }

    public String getMsg() {
        return msg;
    }

    public T getData() {
        return data;
    }

    public Long getTimestamp() {
        return timestamp;
    }

    public Result<T> setCode(int code) {
        this.code = code;
        return this;
    }

    public Result<T> setMsg(String msg) {
        this.msg = msg;
        return this;
    }

    public Result<T> setData(T data) {
        this.data = data;
        return this;
    }

    public Result<T> setTimestamp(Long timestamp) {
        this.timestamp = timestamp;
        return this;
    }
}
