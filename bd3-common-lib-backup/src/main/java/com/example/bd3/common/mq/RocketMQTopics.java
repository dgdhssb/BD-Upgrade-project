package com.example.bd3.common.mq;

/**
 * BD3 全系统 RocketMQ topic 常量（契约见《RocketMQ消息契约.md》）。
 * 命名规范：bd3-<生产者域>-<事件>
 * 注意：RocketMQ topic 名仅允许 ^[%|a-zA-Z0-9_-]+$，禁止出现 "." 点号。
 */
public final class RocketMQTopics {

    /** archive 归档完成后发出，lifecycle 消费后触发迁移评估 */
    public static final String ARCHIVE_COMPLETED = "bd3-archive-completed";

    /** MS-07 data-router 出站归档消息 topic（单 topic 约定，2026-09-01）。
     *  <p>MS-07 将待归档数据流片段统一投递到 {@code topic-archive-storage}（按"目标"分发的单一 topic），
     *  数据归属类型由 {@link com.example.bd3.common.mq.RouteMessage#getDataType()} 短码解算
     *  （RAW/RINEX→RAW、DIFF→DIFF、FIELD→FIELD、RS→忽略），archive 单消费者订阅并做 5→3 映射。
     *  <p>注意：早期 {@code topic-route-raw/-diff/-field}（按"数据类型"分发的三 topic 方案）已作废。 */
    public static final String ARCHIVE_STORAGE = "topic-archive-storage";

    /** 外部 QoS/指标流（待外部提供 topic/tag/schema） */
    public static final String INGEST_QOS = "bd3-ingest-qos";

    /** monitor 产生告警后发出，log 消费落库 + 外部通知通道 */
    public static final String MONITOR_ALERT = "bd3-monitor-alert";

    /** 各服务操作审计，log 消费落库 */
    public static final String LOG_AUDIT = "bd3-log-audit";

    private RocketMQTopics() {
    }
}
