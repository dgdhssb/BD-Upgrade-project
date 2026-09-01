package com.example.bd3.common.model;

import java.util.List;

/**
 * 分页响应模型。
 * 由原官方公共包 {@code com.winston.api.model.PageResult} 迁移至本仓库
 * （com.example.bd3.common.model），版本由本仓库 BOM 统一管理。
 */
public class PageResult<T> {

    private long total;
    private int page;
    private int size;
    private List<T> records;

    public PageResult() {
    }

    public long getTotal() {
        return total;
    }

    public int getPage() {
        return page;
    }

    public int getSize() {
        return size;
    }

    public List<T> getRecords() {
        return records;
    }

    public PageResult<T> setTotal(long total) {
        this.total = total;
        return this;
    }

    public PageResult<T> setPage(int page) {
        this.page = page;
        return this;
    }

    public PageResult<T> setSize(int size) {
        this.size = size;
        return this;
    }

    public PageResult<T> setRecords(List<T> records) {
        this.records = records;
        return this;
    }
}
