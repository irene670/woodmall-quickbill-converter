export interface LineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface BillingData {
  items: LineItem[];
  preTaxTotal: number;
  taxAmount: number;
  totalWithTax: number;
}

export type FileType = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'application/vnd.ms-excel' | string;

export interface UploadedFile {
  file: File;
  previewUrl: string;
  type: FileType;
  base64?: string;
}

export interface HeaderMapping {
  name: string | null;      // Target: 品名
  quantity: string | null;  // Target: 數量
  unitPrice: string | null; // Target: 單價
  subtotal: string | null;  // Target: 小計
}

export interface StructureAnalysisResult {
  headers: string[];
  suggestedMapping: HeaderMapping;
}

export type ProcessingStep = 'upload' | 'mapping' | 'result';
