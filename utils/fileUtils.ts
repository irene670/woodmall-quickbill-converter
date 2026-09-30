// Function to convert file to Base64
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // Remove the Data-URL declaration (e.g., "data:image/png;base64,")
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Helper to format currency (optional, mainly for display)
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(amount);
};

// Helper to format unit price (optional, allows decimals for unit prices)
export const formatUnitPrice = (amount: number) => {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(amount);
};