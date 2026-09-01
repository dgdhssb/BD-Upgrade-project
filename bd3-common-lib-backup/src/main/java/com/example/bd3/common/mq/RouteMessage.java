package com.example.bd3.common.mq;

import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 归档入口路由消息（对齐 MS-07 data-router 的 {@code RouteMessage<T>} 信封，本组等价 DTO）。
 *
 * <p><b>字段以 MS-07 权威契约《消息契约-MS-07-数据路由.md》(2026-08-30) 为准。</b>
 * 原始字段：messageId / dataType / source / payload(T) / metadata(Map<String,Object>) /
 * timestamp / urgent / tags / stationId / region / priority / priorityLevel。
 *
 * <p><b>文件引用位置（待确认）</b>：RouteMessage 本身不含 filePath 字段，真实文件引用位于
 * {@code payload}（泛型 T，归档场景为归档负载对象）或 {@code metadata}(Map) 内，具体键名以
 * 《消息契约.md》第 1/3 节统一信封为准。当前 {@link #extractFileRef()} 按候选 key 提取，
 * 待契约文档补齐后固化键名。
 *
 * <p>dataType 短码（MS-07）：RAW / DIFF / RINEX / RS / FIELD（RS = REMOTE_SENSING，遥感，边界外）。
 * 本组落库规范为 RAW/DIFF/FIELD，5→3 映射在 archive 消费侧（见 IngestService）。
 */
@Data
public class RouteMessage {

    private String messageId;
    private String dataType;
    private String source;
    private Object payload;
    private Map<String, Object> metadata;
    private Object timestamp;
    private Boolean urgent;
    private List<String> tags;
    private String stationId;
    private String region;
    private String priority;
    private Integer priorityLevel;

    /**
     * 从 payload / metadata 中提取文件引用（对象存储 key 或路径）。
     * 候选键按优先级尝试，命中第一个非空字符串即返回；键名待《消息契约.md》统一信封确认后固化。
     */
    public String extractFileRef() {
        String[] keys = {"filePath", "file_path", "objectKey", "object_key", "path", "url", "fileUrl", "storageKey", "key"};
        if (payload instanceof Map) {
            Map<?, ?> p = (Map<?, ?>) payload;
            for (String k : keys) {
                Object v = p.get(k);
                if (v instanceof String s && !s.isBlank()) {
                    return s;
                }
            }
        }
        if (metadata != null) {
            for (String k : keys) {
                Object v = metadata.get(k);
                if (v instanceof String s && !s.isBlank()) {
                    return s;
                }
            }
        }
        return null;
    }

    /**
     * 从 payload / metadata 通用取字段（供 fileSize / checksum 等附加字段提取）。
     * 先在 payload(Map) 找，再到 metadata(Map) 找，命中即返回；均未命中返回 null。
     */
    public Object getField(String key) {
        if (payload instanceof Map) {
            Object v = ((Map<?, ?>) payload).get(key);
            if (v != null) {
                return v;
            }
        }
        if (metadata != null) {
            Object v = metadata.get(key);
            if (v != null) {
                return v;
            }
        }
        return null;
    }

    /**
     * 提取待归档文件的完整内容（字节数组）。MS-07 单次发送的即是一个完整文件
     * （RINEX / RTCM / 图片），可直接落盘，无需跨消息聚合。
     * <p>文件字节可位于 payload 内的多个候选键之一，或 payload 本身即为字节。
     * <p>候选键（宽容提取，键名待统一信封确认后固化）：content / data / bytes / rinexContent / segment / chunk / payload。
     * <p>payload 若为 String，视为 UTF-8 文本；若为 byte[]，直接返回。
     * <p>命中不了返回 null，调用方自行决定跳过或告警。
     */
    public byte[] extractSegmentContent() {
        if (payload == null) {
            return null;
        }
        if (payload instanceof byte[] b) {
            return b;
        }
        if (payload instanceof String s) {
            return s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        }
        if (payload instanceof Map) {
            Map<?, ?> p = (Map<?, ?>) payload;
            String[] keys = {"segment", "content", "data", "bytes", "rinexContent", "chunk", "payload", "segmentContent"};
            for (String k : keys) {
                Object v = p.get(k);
                if (v instanceof byte[] b) {
                    return b;
                }
                if (v instanceof String s && !s.isBlank()) {
                    return s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                }
            }
        }
        if (metadata != null) {
            String[] keys = {"segment", "content", "data", "bytes", "rinexContent", "chunk", "segmentContent"};
            for (String k : keys) {
                Object v = metadata.get(k);
                if (v instanceof byte[] b) {
                    return b;
                }
                if (v instanceof String s && !s.isBlank()) {
                    return s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                }
            }
        }
        return null;
    }

    /**
     * 提取观测数据数组（2026-09-01 对齐 MS-07 实际消息格式）。
     *
     * <p>MS-07 出站归档消息（见《07-to-10-对接说明.md》2.3(b)）：payload 为 {@code RawObservationMessage}，
     * 其中 {@code rinexContent}（Object）装载观测数据数组 {@code List<GnssObservationDTO>}
     * （伪距/载波相位/SNR/仰角/CN0 等），{@code metadata.fileName} 为原始 RINEX 文件名。
     *
     * <p>返回 payload 内 {@code rinexContent} 的原始值（List / JsonNode 等），
     * 由调用方负责序列化/落库。候选键：rinexContent / observations / obsList / content。
     * 命中不到返回 null。
     */
    public Object extractRinexContent() {
        if (payload instanceof Map) {
            Map<?, ?> p = (Map<?, ?>) payload;
            String[] keys = {"rinexContent", "observations", "obsList", "content"};
            for (String k : keys) {
                Object v = p.get(k);
                if (v != null) {
                    return v;
                }
            }
        }
        return null;
    }

    /**
     * 提取文件名（宽容）。候选键：fileName / file_name / name / filename；命中不到则返回 null。
     */
    public String extractFileName() {
        String[] keys = {"fileName", "file_name", "name", "filename"};
        if (payload instanceof Map) {
            Map<?, ?> p = (Map<?, ?>) payload;
            for (String k : keys) {
                Object v = p.get(k);
                if (v instanceof String s && !s.isBlank()) {
                    return s;
                }
            }
        }
        if (metadata != null) {
            for (String k : keys) {
                Object v = metadata.get(k);
                if (v instanceof String s && !s.isBlank()) {
                    return s;
                }
            }
        }
        return null;
    }

    /**
     * 提取业务任务 ID（宽容，FIELD 场景用）。候选键：taskId / task_id / task；命中不到返回 null。
     */
    public String extractTaskId() {
        String[] keys = {"taskId", "task_id", "task"};
        if (payload instanceof Map) {
            Map<?, ?> p = (Map<?, ?>) payload;
            for (String k : keys) {
                Object v = p.get(k);
                if (v instanceof String s && !s.isBlank()) {
                    return s;
                }
            }
        }
        if (metadata != null) {
            for (String k : keys) {
                Object v = metadata.get(k);
                if (v instanceof String s && !s.isBlank()) {
                    return s;
                }
            }
        }
        return null;
    }

    /**
     * 提取片段序号（宽容，用于乱序/幂等）。候选键：seq / sequence / offset / chunkIndex / index；
     * 命中数字则返回其 long 值，否则返回 null。
     */
    public Long extractSequence() {
        String[] keys = {"seq", "sequence", "offset", "chunkIndex", "index"};
        Object v = null;
        if (payload instanceof Map) {
            for (String k : keys) {
                v = ((Map<?, ?>) payload).get(k);
                if (v != null) {
                    break;
                }
            }
        }
        if (v == null && metadata != null) {
            for (String k : keys) {
                v = metadata.get(k);
                if (v != null) {
                    break;
                }
            }
        }
        if (v instanceof Number n) {
            return n.longValue();
        }
        if (v instanceof String s) {
            try {
                return Long.parseLong(s.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }
}
