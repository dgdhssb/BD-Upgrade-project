package com.example.bd3.common.util;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.example.bd3.common.model.PageResult;

import java.util.List;

public class PageUtils {

    /**
     * 将 MyBatis-Plus 的 IPage 对象转换为自定义 PageResult
     */
    public static <T> PageResult<T> toPageResult(IPage<T> page) {
        return new PageResult<T>()
                .setTotal(page.getTotal())
                .setPage((int) page.getCurrent())
                .setSize((int) page.getSize())
                .setRecords(page.getRecords());
    }
}