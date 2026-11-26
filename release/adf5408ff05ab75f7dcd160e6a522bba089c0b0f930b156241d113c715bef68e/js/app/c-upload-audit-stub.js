/* split from js/app-main.js (block C_upload_audit_stub) — verbatim code; cross-module state writes go through __set_* helpers */
/* ══════════════════════════════════════════
   UPLOAD ENGINE + UPLOAD CARD — منقول بالكامل لـ js/upload-engine.js
   alias محلي عشان الاستدعاءات القديمة (4 دوال) تفضل شغالة بدون أي تعديل
══════════════════════════════════════════ */
const uploadToCloudinaryWithProgress = (...args) => window.uploadToCloudinaryWithProgress(...args);
const _buildUploadCard = (...args) => window._buildUploadCard(...args);
const _getFileCategory = (...args) => window._getFileCategory(...args);
const _formatSize = (...args) => window._formatSize(...args);

/* ══════════════════════════════════════════
/* ══════════════════════════════════════════
   AUDIT LOG SYSTEM — منقول بالكامل لـ js/audit-log.js
   alias محلي بسيط عشان كل الاستدعاءات القديمة (AUDIT_ACTIONS.X / writeAuditLog(...))
   المنتشرة في الملف تفضل شغالة بدون أي تعديل عليها
══════════════════════════════════════════ */
const AUDIT_ACTIONS = new Proxy({}, { get: (_, prop) => window.AUDIT_ACTIONS?.[prop] });
const writeAuditLog = (...args) => window.writeAuditLog(...args);

export { AUDIT_ACTIONS, _buildUploadCard, _getFileCategory, uploadToCloudinaryWithProgress, writeAuditLog };
