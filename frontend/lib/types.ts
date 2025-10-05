export interface Holding {
    security_name: string;
    security_id?: string;
    security_type: 'Stock' | 'Mutual Fund' | 'Bond' | 'Others';
    quantity?: number;
    average_cost_per_unit?: number;
    market_value?: number;
    price?: number;
    currency?: string;
    holding_date?: string;
  }
  
  export interface Transaction {
    transaction_date: string;
    transaction_type: string;
    security_name: string;
    security_id?: string;
    security_type: 'Stock' | 'Mutual Fund' | 'Bond' | 'Others';
    quantity?: number;
    price?: number;
    net_amount?: number;
    gross_amount?: number;
    currency?: string;
  }
  
  export interface ExtractedData {
    statement_date?: string;
    account_id?: string;
    holdings: Holding[];
    transactions: Transaction[];
  }