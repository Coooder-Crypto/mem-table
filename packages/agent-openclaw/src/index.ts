export interface OpenClawMemTableConfig {
  endpoint: string;
  observe: boolean;
}

export const defaultOpenClawMemTableConfig: OpenClawMemTableConfig = {
  endpoint: "http://127.0.0.1:3838",
  observe: true
};

