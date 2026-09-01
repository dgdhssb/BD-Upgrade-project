package com.example.bd3.common.mq;

import lombok.Data;

/**
 * 操作审计事件。各服务在关键写操作后发出，log 服务消费落库。
 */
@Data
public class AuditEvent {

    private String schemaVersion = "v0.1";
    private String module;       // 服务/模块标识，如 archive / metadata / lifecycle
    private String operation;    // 操作描述，如 createArchive / ingestMetadata / createMigration
    private String user;         // 操作人账号
    private Boolean success;     // 是否成功
    private String detail;       // 扩展信息（JSON 或文本）
    private Long timestamp;      // 操作时间戳(ms)
}
