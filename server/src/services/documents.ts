/** Shared document queries / serialization used by several routers. */
import type { AuthUser } from '../types.js';
import { documentCapabilities } from './access.js';

export const DOCUMENT_SELECT = `
  SELECT d.id, d.title, d.description, d.status, d.issue_date, d.expiry_date, d.is_archived, d.archived_at,
         d.created_at, d.updated_at, d.client_id, c.name AS client_name,
         d.employee_id, eu.first_name || ' ' || eu.last_name AS employee_name, e.employee_number,
         d.category_id, cat.name AS category_name, cat.is_certificate,
         d.folder_id, f.name AS folder_name,
         v.id AS version_id, v.version_number, v.original_filename, v.file_ext, v.mime_type, v.size_bytes,
         v.created_at AS uploaded_at, v.uploaded_by AS uploaded_by_id,
         ub.first_name || ' ' || ub.last_name AS uploaded_by_name,
         (d.expiry_date - CURRENT_DATE) AS days_to_expiry
    FROM documents d
    JOIN clients c ON c.id = d.client_id
    JOIN employees e ON e.id = d.employee_id
    JOIN users eu ON eu.id = e.user_id
    LEFT JOIN document_categories cat ON cat.id = d.category_id
    LEFT JOIN folders f ON f.id = d.folder_id
    LEFT JOIN document_versions v ON v.id = d.current_version_id
    LEFT JOIN users ub ON ub.id = v.uploaded_by`;

export function serializeDocument(r: Record<string, any>, user?: AuthUser) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    issueDate: r.issue_date,
    expiryDate: r.expiry_date,
    daysToExpiry: r.days_to_expiry ?? null,
    isArchived: r.is_archived,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    clientId: r.client_id,
    clientName: r.client_name,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    employeeNumber: r.employee_number,
    categoryId: r.category_id,
    categoryName: r.category_name,
    isCertificate: r.is_certificate ?? false,
    folderId: r.folder_id,
    folderName: r.folder_name,
    file: r.version_id
      ? {
          versionId: r.version_id,
          versionNumber: r.version_number,
          filename: r.original_filename,
          ext: r.file_ext,
          mimeType: r.mime_type,
          sizeBytes: r.size_bytes,
        }
      : null,
    uploadedAt: r.uploaded_at,
    uploadedById: r.uploaded_by_id,
    uploadedByName: r.uploaded_by_name,
    ...(user ? { can: documentCapabilities(user, r as { status: any; is_archived: boolean }) } : {}),
  };
}

/** Storage keys are generated server-side and never include user input. */
export const storageKey = (clientId: string, documentId: string, unique: string, ext: string) =>
  `clients/${clientId}/documents/${documentId}/${unique}.${ext}`;
