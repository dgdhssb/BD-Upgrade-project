package com.example.bd3.common.mq;

import lombok.Data;

/**
 * 归档完成事件。archive 落库成功后发出，lifecycle 消费以触发迁移评估。
 * 契约版本：v0.1（schemaVersion 用于后续演进）。
 */
@Data
public class ArchiveCompletedEvent {

    private String schemaVersion = "v0.1";
    private String archiveId;
    private String dataType;     // RAW / DIFF / FIELD
    private String stationId;
    private String storageTier;  // HOT / NEARLINE / COLD
    private String filePath;
    private Long fileSize;
    private Long timestamp;      // 归档完成时间戳(ms)
}
