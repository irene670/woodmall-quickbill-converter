import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, FileText, ArrowRight, Loader2, Copy, CheckCircle, RefreshCw, FileSpreadsheet, GripVertical, X, Info, Calculator, Settings2 } from 'lucide-react';
import { UploadedFile, BillingData, HeaderMapping, ProcessingStep } from './types';
import { fileToBase64, formatCurrency, formatUnitPrice } from './utils/fileUtils';
import { extractBillingData, analyzeDocumentStructure } from './services/geminiService';

const App: React.FC = () => {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);

  // Steps: 'upload' -> 'mapping' -> 'result'
  const [currentStep, setCurrentStep] = useState<ProcessingStep>('upload');

  // Analysis Data
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<HeaderMapping>({
    name: null,
    quantity: null,
    unitPrice: null,
    subtotal: null
  });

  // Settings
  const [sourceTaxType, setSourceTaxType] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [hideZeroQty, setHideZeroQty] = useState(false);

  // Advanced Calculation Settings
  const [calcPriority, setCalcPriority] = useState<'unit' | 'subtotal'>('unit');
  // New granular rounding settings
  const [roundingMethod, setRoundingMethod] = useState<'round' | 'floor' | 'ceil'>('round');
  const [roundingPrecision, setRoundingPrecision] = useState<number>(0);

  // Calculation Modes (Extraction Phase)
  const [calcPriceFromSubtotal, setCalcPriceFromSubtotal] = useState(false);
  const [calcSubtotalFromPrice, setCalcSubtotalFromPrice] = useState(false);

  // Result Data
  const [extractedData, setExtractedData] = useState<BillingData | null>(null);

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const tableRef = useRef<HTMLTableElement>(null);

  // --- File Handling ---

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const objectUrl = URL.createObjectURL(file);

      setUploadedFile({
        file,
        previewUrl: objectUrl,
        type: file.type
      });
      // Reset states
      setCurrentStep('upload');
      setExtractedData(null);
      setDetectedHeaders([]);
      setMapping({ name: null, quantity: null, unitPrice: null, subtotal: null });
      setError(null);

      // Reset settings to defaults
      setSourceTaxType('exclusive');
      setHideZeroQty(false);
      setCalcPriority('unit');
      setRoundingMethod('round');
      setRoundingPrecision(0);
      setCalcPriceFromSubtotal(false);
      setCalcSubtotalFromPrice(false);

    }
  };

  // --- Step 1 -> 2: Analyze Structure ---

  const startAnalysis = async () => {
    if (!uploadedFile) return;

    setIsLoading(true);
    setLoadingMessage("AI 正在分析文件格式與欄位...");
    setError(null);

    try {
      const base64 = await fileToBase64(uploadedFile.file);
      const result = await analyzeDocumentStructure(base64, uploadedFile.file.type);

      setDetectedHeaders(result.headers || []);

      // Use AI suggested mapping if available
      if (result.suggestedMapping) {
        setMapping(result.suggestedMapping);
      }

      setCurrentStep('mapping');
    } catch (err: any) {
      setError(err.message || "分析文件失敗，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  // --- Step 2: Drag and Drop Logic ---

  const handleDragStart = (e: React.DragEvent, header: string) => {
    e.dataTransfer.setData("header", header);
  };

  const handleDrop = (e: React.DragEvent, targetField: keyof HeaderMapping) => {
    e.preventDefault();
    const header = e.dataTransfer.getData("header");

    // Logic to ensure mutual exclusivity with calculation modes
    if (targetField === 'unitPrice' && calcPriceFromSubtotal) return;
    if (targetField === 'subtotal' && calcSubtotalFromPrice) return;

    if (header) {
      setMapping(prev => ({ ...prev, [targetField]: header }));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const clearMapping = (targetField: keyof HeaderMapping) => {
    setMapping(prev => ({ ...prev, [targetField]: null }));
  };

  // Toggle Calculation Handlers
  const toggleCalcPriceFromSubtotal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setCalcPriceFromSubtotal(checked);
    if (checked) {
      clearMapping('unitPrice'); // Clear unit price mapping if we calculate it
    }
  };

  const toggleCalcSubtotalFromPrice = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setCalcSubtotalFromPrice(checked);
    if (checked) {
      clearMapping('subtotal'); // Clear subtotal mapping if we calculate it
    }
  };

  // --- Step 2 -> 3: Generate Data ---

  const generateFinalData = async () => {
    if (!uploadedFile) return;

    setIsLoading(true);
    setLoadingMessage("AI 正在根據您的設定提取數據...");
    setError(null);

    try {
      const base64 = await fileToBase64(uploadedFile.file);
      const data = await extractBillingData(base64, uploadedFile.file.type, mapping);
      setExtractedData(data);
      setCurrentStep('result');
    } catch (err: any) {
      setError(err.message || "生成數據失敗");
    } finally {
      setIsLoading(false);
    }
  };

  // --- Output Calculation Logic ---

  const calculatedData = useMemo(() => {
    if (!extractedData) return null;

    const applyRounding = (num: number, method: string, precision: number) => {
      const factor = Math.pow(10, precision);
      let result = num;
      if (method === 'floor') result = Math.floor(num * factor) / factor;
      else if (method === 'ceil') result = Math.ceil(num * factor) / factor;
      else result = Math.round(num * factor) / factor; // round default
      return result;
    };

    let items = extractedData.items.map(item => {
      let rawUnitPrice = item.unitPrice;
      let rawSubtotal = item.subtotal;
      const quantity = item.quantity;

      // 1. Fill gaps based on Extraction Phase settings
      if (calcPriceFromSubtotal) {
        rawUnitPrice = quantity !== 0 ? rawSubtotal / quantity : 0;
      }
      if (calcSubtotalFromPrice) {
        rawSubtotal = rawUnitPrice * quantity;
      }

      let finalUnitPrice = 0;
      let finalSubtotal = 0;

      // 2. Apply Tax Logic & Calculation Priority
      if (calcPriority === 'subtotal') {
        // Mode: Calculate from Total (Prioritize Subtotal Accuracy)
        // Usually Subtotal is an integer (Standard in TW invoices).

        let baseSubtotal = rawSubtotal;
        if (sourceTaxType === 'inclusive') {
          baseSubtotal = baseSubtotal / 1.05;
        }

        // When prioritizing subtotal, we usually round subtotal to integer.
        finalSubtotal = Math.round(baseSubtotal);

        // Back-calculate unit price
        finalUnitPrice = quantity !== 0 ? finalSubtotal / quantity : 0;

      } else {
        // Mode: Calculate from Unit (Prioritize Unit Price Accuracy) - Default
        // Formula: Unit = Round(SourceUnit / 1.05, method, precision)

        let baseUnit = rawUnitPrice;
        if (sourceTaxType === 'inclusive') {
          baseUnit = baseUnit / 1.05;
        }

        finalUnitPrice = applyRounding(baseUnit, roundingMethod, roundingPrecision);

        // Calculate subtotal from the rounded unit price
        finalSubtotal = Math.round(finalUnitPrice * quantity);
      }

      return {
        ...item,
        unitPrice: finalUnitPrice,
        subtotal: finalSubtotal
      };
    });

    if (hideZeroQty) {
      items = items.filter(item => item.quantity !== 0);
    }

    const preTaxTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = Math.round(preTaxTotal * 0.05);
    const totalWithTax = preTaxTotal + taxAmount;

    return {
      items,
      preTaxTotal,
      taxAmount,
      totalWithTax
    };
  }, [extractedData, sourceTaxType, hideZeroQty, calcPriceFromSubtotal, calcSubtotalFromPrice, calcPriority, roundingMethod, roundingPrecision]);

  const copyTableToClipboard = () => {
    if (!tableRef.current) return;
    const range = document.createRange();
    range.selectNode(tableRef.current);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand('copy');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        console.error("Copy failed", err);
      }
      selection.removeAllRanges();
    }
  };

  // --- Render Components ---

  const renderMappingStep = () => {
    return (
      <div className="flex flex-col h-full space-y-6 relative">
         {/* Loading Overlay inside Mapping Step */}
         {isLoading && (
            <div className="absolute inset-0 bg-white/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm rounded-xl">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
              <p className="text-lg font-semibold text-slate-700">{loadingMessage}</p>
            </div>
         )}

         {/* Settings Section */}
         <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
             <div className="flex items-center mb-3">
               <Settings2 className="w-5 h-5 text-slate-600 mr-2" />
               <h3 className="text-lg font-bold text-slate-800">轉換設定</h3>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Tax Type */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-xs font-bold text-slate-500 uppercase block mb-2">來源金額</span>
                    <div className="flex flex-col space-y-2">
                      <label className="flex items-center cursor-pointer">
                          <input type="radio" name="taxType" checked={sourceTaxType === 'exclusive'} onChange={() => setSourceTaxType('exclusive')} className="text-blue-600" />
                          <span className="text-sm text-slate-700 ml-2">未稅</span>
                      </label>
                      <label className="flex items-center cursor-pointer">
                          <input type="radio" name="taxType" checked={sourceTaxType === 'inclusive'} onChange={() => setSourceTaxType('inclusive')} className="text-blue-600" />
                          <span className="text-sm text-slate-700 ml-2">含稅 (÷1.05)</span>
                      </label>
                    </div>
                </div>

                {/* 2. Calculation Priority */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-xs font-bold text-slate-500 uppercase block mb-2">計算優先權</span>
                    <div className="flex flex-col space-y-2">
                      <label className="flex items-center cursor-pointer" title="先算單價，小計 = 單價 × 數量">
                          <input type="radio" name="calcPriority" checked={calcPriority === 'unit'} onChange={() => setCalcPriority('unit')} className="text-blue-600" />
                          <span className="text-sm text-slate-700 ml-2">由單價計算 (標準)</span>
                      </label>
                      <label className="flex items-center cursor-pointer" title="先算小計，單價 = 小計 ÷ 數量">
                          <input type="radio" name="calcPriority" checked={calcPriority === 'subtotal'} onChange={() => setCalcPriority('subtotal')} className="text-blue-600" />
                          <span className="text-sm text-slate-700 ml-2">由小計計算 (回推)</span>
                      </label>
                    </div>
                </div>

                {/* 3. Unit Price Settings (New) */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-xs font-bold text-slate-500 uppercase block mb-2">未稅單價設定 (優先權:單價)</span>
                    <div className="flex flex-col space-y-2">
                      <select
                        value={roundingMethod}
                        onChange={(e) => setRoundingMethod(e.target.value as any)}
                        className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        disabled={calcPriority !== 'unit'}
                      >
                        <option value="round">四捨五入</option>
                        <option value="floor">無條件捨去</option>
                        <option value="ceil">無條件進位</option>
                      </select>

                      <select
                        value={roundingPrecision}
                        onChange={(e) => setRoundingPrecision(Number(e.target.value))}
                        className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        disabled={calcPriority !== 'unit'}
                      >
                        <option value={0}>取整數 (0位)</option>
                        <option value={1}>小數點後 1 位</option>
                        <option value={2}>小數點後 2 位</option>
                        <option value={3}>小數點後 3 位</option>
                        <option value={4}>小數點後 4 位</option>
                      </select>
                    </div>
                </div>

                {/* 4. Misc */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-xs font-bold text-slate-500 uppercase block mb-2">其他</span>
                    <label className="flex items-center space-x-2 cursor-pointer select-none">
                        <input type="checkbox" checked={hideZeroQty} onChange={(e) => setHideZeroQty(e.target.checked)} className="rounded text-blue-600" />
                        <span className="text-sm font-medium text-slate-700">隱藏數量為 0 的品項</span>
                    </label>
                </div>
             </div>
         </div>

         <div className="flex-1 flex flex-col min-h-0 gap-6">
           {/* Source Headers - Top Bar */}
           <div className="bg-slate-100 p-5 rounded-xl border border-slate-200 shadow-inner">
              <h4 className="text-sm font-bold text-slate-600 mb-3 uppercase tracking-wider flex items-center">
                 <FileSpreadsheet className="w-4 h-4 mr-2" /> 來源檔案標題 (請拖曳)
              </h4>
              <div className="flex flex-wrap gap-3">
                {detectedHeaders.length === 0 && <p className="text-sm text-slate-400">未偵測到明顯標題。</p>}
                {detectedHeaders.map((header, idx) => (
                  <div
                    key={idx}
                    draggable
                    onDragStart={(e) => handleDragStart(e, header)}
                    className="cursor-grab active:cursor-grabbing bg-white px-4 py-2 rounded-lg shadow border border-slate-300 hover:border-blue-500 hover:shadow-md hover:bg-blue-50 transition-all flex items-center text-base font-medium text-slate-800 select-none"
                  >
                    <GripVertical className="w-4 h-4 text-slate-400 mr-2" />
                    {header}
                  </div>
                ))}
              </div>
           </div>

           {/* Target Mapping Zones - Large Grid (4 columns on Large Screens) */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 overflow-y-auto">

              {/* Product Name */}
              <div className="flex flex-col">
                 <div className="flex justify-between items-baseline mb-2">
                    <span className="text-lg font-bold text-slate-800">品名 (Product Name)</span>
                 </div>
                 <div
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'name')}
                    className={`
                      flex-1 min-h-[120px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-colors relative
                      ${mapping.name
                        ? 'bg-blue-50 border-blue-400'
                        : 'bg-white border-slate-300 hover:border-blue-300 hover:bg-slate-50'}
                    `}
                 >
                   {mapping.name ? (
                     <>
                       <span className="font-bold text-xl text-blue-700 text-center break-words w-full">{mapping.name}</span>
                       <button onClick={() => clearMapping('name')} className="absolute top-2 right-2 p-1 hover:bg-blue-200 rounded-full text-blue-500">
                         <X className="w-5 h-5" />
                       </button>
                     </>
                   ) : (
                     <span className="text-slate-400 pointer-events-none">拖曳「品名」欄位至此</span>
                   )}
                 </div>
              </div>

              {/* Quantity */}
              <div className="flex flex-col">
                 <div className="flex justify-between items-baseline mb-2">
                    <span className="text-lg font-bold text-slate-800">數量 (Quantity)</span>
                 </div>
                 <div
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'quantity')}
                    className={`
                      flex-1 min-h-[120px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-colors relative
                      ${mapping.quantity
                        ? 'bg-blue-50 border-blue-400'
                        : 'bg-white border-slate-300 hover:border-blue-300 hover:bg-slate-50'}
                    `}
                 >
                   {mapping.quantity ? (
                     <>
                       <span className="font-bold text-xl text-blue-700 text-center break-words w-full">{mapping.quantity}</span>
                       <button onClick={() => clearMapping('quantity')} className="absolute top-2 right-2 p-1 hover:bg-blue-200 rounded-full text-blue-500">
                         <X className="w-5 h-5" />
                       </button>
                     </>
                   ) : (
                     <span className="text-slate-400 pointer-events-none">拖曳「數量」欄位至此</span>
                   )}
                 </div>
              </div>

              {/* Unit Price */}
              <div className="flex flex-col">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-lg font-bold text-slate-800">單價 (Unit Price)</span>
                 </div>
                 <div className="flex flex-col h-full">
                    <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, 'unitPrice')}
                        className={`
                          flex-1 min-h-[100px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-colors relative mb-3
                          ${calcPriceFromSubtotal ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' :
                            mapping.unitPrice ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-300 hover:border-blue-300'}
                        `}
                    >
                      {calcPriceFromSubtotal ? (
                        <span className="text-slate-500 font-medium flex items-center"><Calculator className="w-5 h-5 mr-2"/> 自動由小計推算</span>
                      ) : mapping.unitPrice ? (
                        <>
                          <span className="font-bold text-xl text-blue-700 text-center break-words w-full">{mapping.unitPrice}</span>
                          <button onClick={() => clearMapping('unitPrice')} className="absolute top-2 right-2 p-1 hover:bg-blue-200 rounded-full text-blue-500">
                            <X className="w-5 h-5" />
                          </button>
                        </>
                      ) : (
                        <span className="text-slate-400 pointer-events-none">拖曳「單價」欄位至此</span>
                      )}
                    </div>
                    <label className="flex items-center p-2 bg-orange-50 border border-orange-100 rounded-lg cursor-pointer hover:bg-orange-100 transition-colors">
                        <input
                            type="checkbox"
                            checked={calcPriceFromSubtotal}
                            onChange={toggleCalcPriceFromSubtotal}
                            className="w-5 h-5 text-orange-600 rounded mr-3"
                        />
                        <span className="text-sm font-bold text-orange-800">無單價，由小計÷數量</span>
                    </label>
                 </div>
              </div>

              {/* Subtotal */}
              <div className="flex flex-col">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-lg font-bold text-slate-800">小計 (Subtotal)</span>
                 </div>
                 <div className="flex flex-col h-full">
                    <div
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, 'subtotal')}
                        className={`
                          flex-1 min-h-[100px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-colors relative mb-3
                          ${calcSubtotalFromPrice ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' :
                            mapping.subtotal ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-300 hover:border-blue-300'}
                        `}
                    >
                      {calcSubtotalFromPrice ? (
                        <span className="text-slate-500 font-medium flex items-center"><Calculator className="w-5 h-5 mr-2"/> 自動由單價推算</span>
                      ) : mapping.subtotal ? (
                        <>
                          <span className="font-bold text-xl text-blue-700 text-center break-words w-full">{mapping.subtotal}</span>
                          <button onClick={() => clearMapping('subtotal')} className="absolute top-2 right-2 p-1 hover:bg-blue-200 rounded-full text-blue-500">
                            <X className="w-5 h-5" />
                          </button>
                        </>
                      ) : (
                        <span className="text-slate-400 pointer-events-none">拖曳「小計」欄位至此</span>
                      )}
                    </div>
                    <label className="flex items-center p-2 bg-purple-50 border border-purple-100 rounded-lg cursor-pointer hover:bg-purple-100 transition-colors">
                        <input
                            type="checkbox"
                            checked={calcSubtotalFromPrice}
                            onChange={toggleCalcSubtotalFromPrice}
                            className="w-5 h-5 text-purple-600 rounded mr-3"
                        />
                        <span className="text-sm font-bold text-purple-800">無小計，由單價×數量</span>
                    </label>
                 </div>
              </div>

           </div>
         </div>

         <div className="mt-4 flex space-x-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => setCurrentStep('upload')}
              className="px-6 py-3 rounded-lg text-slate-600 bg-slate-200 hover:bg-slate-300 font-medium transition-colors"
            >
              重新上傳
            </button>
            <button
              onClick={generateFinalData}
              className="flex-1 px-6 py-3 rounded-lg text-white bg-blue-600 hover:bg-blue-700 font-bold shadow-sm transition-all flex items-center justify-center space-x-2 text-lg"
            >
              <span>確認並生成結果</span>
              <ArrowRight className="w-6 h-6" />
            </button>
         </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setCurrentStep('upload')}>
            <div className="bg-blue-600 p-2 rounded-lg">
              <FileSpreadsheet className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">
              對帳單轉換助手 <span className="text-sm font-normal text-slate-500 ml-2">Powered by Gemini 3 Flash</span>
            </h1>
          </div>
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
            安全連線
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentStep === 'mapping' ? (
           // FULL WIDTH MAPPING LAYOUT
           <div className="h-[calc(100vh-8rem)] bg-white p-6 rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
             {renderMappingStep()}
           </div>
        ) : (
           // SPLIT LAYOUT FOR UPLOAD AND RESULT
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-8rem)]">
              {/* LEFT PANEL */}
              <div className="flex flex-col space-y-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-full overflow-hidden relative">

                {/* Loading Overlay */}
                {isLoading && (
                   <div className="absolute inset-0 bg-white/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
                     <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                     <p className="text-lg font-semibold text-slate-700">{loadingMessage}</p>
                   </div>
                )}

                {currentStep === 'upload' && (
                  <>
                    <h2 className="text-lg font-semibold text-slate-700 flex items-center">
                      <span className="bg-slate-100 text-slate-600 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">1</span>
                      上傳來源檔案 (PDF / Excel)
                    </h2>

                    <div className="relative group cursor-pointer">
                      <input
                        type="file"
                        accept=".pdf,.xlsx,.xls"
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
                      />
                      <div className={`
                        border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-colors
                        ${uploadedFile ? 'border-blue-300 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}
                      `}>
                        {uploadedFile ? (
                           <div className="text-center">
                              {uploadedFile.type.includes('pdf') ?
                                <FileText className="w-10 h-10 text-red-500 mx-auto mb-2" /> :
                                <FileSpreadsheet className="w-10 h-10 text-green-600 mx-auto mb-2" />
                              }
                              <p className="font-medium text-slate-700">{uploadedFile.file.name}</p>
                              <p className="text-xs text-slate-500 mt-1">點擊更換檔案</p>
                           </div>
                        ) : (
                          <div className="text-center">
                            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                            <p className="text-sm font-medium text-slate-600">拖放或點擊上傳</p>
                            <p className="text-xs text-slate-400 mt-1">支援 PDF 或 Excel</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={startAnalysis}
                      disabled={!uploadedFile || isLoading}
                      className={`
                        w-full py-3 rounded-xl font-semibold text-white shadow-sm flex items-center justify-center space-x-2 transition-all
                        ${!uploadedFile || isLoading ? 'bg-slate-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'}
                      `}
                    >
                      <span>分析檔案格式</span>
                      <ArrowRight className="w-5 h-5" />
                    </button>

                    {error && (
                      <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-100">
                        {error}
                      </div>
                    )}

                    <div className="flex-1 min-h-0 border rounded-xl overflow-hidden bg-slate-100 flex flex-col">
                       <div className="bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                         原始檔案預覽
                       </div>
                       <div className="flex-1 overflow-auto relative">
                         {uploadedFile ? (
                           uploadedFile.type.includes('pdf') ? (
                             <iframe
                               src={uploadedFile.previewUrl}
                               className="w-full h-full"
                               title="PDF Preview"
                             />
                           ) : (
                             <div className="flex h-full items-center justify-center p-6 text-center">
                               <div>
                                 <FileSpreadsheet className="mx-auto mb-3 h-12 w-12 text-green-600" />
                                 <p className="font-medium text-slate-700">{uploadedFile.file.name}</p>
                                 <p className="mt-1 text-xs text-slate-400">
                                   Excel 檔案將由 AI 分析欄位，完成後可在下一步確認對應。
                                 </p>
                               </div>
                             </div>
                           )
                         ) : (
                           <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                             尚未選擇檔案
                            </div>
                         )}
                       </div>
                    </div>
                  </>
                )}

                {currentStep === 'result' && (
                   <div className="flex flex-col h-full items-center justify-center text-center space-y-4">
                      <div className="bg-green-100 p-4 rounded-full">
                        <CheckCircle className="w-12 h-12 text-green-600" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-800">轉換完成！</h3>
                      <p className="text-slate-500 max-w-xs">您的對帳單已生成。請在右側確認結果並一鍵複製。</p>
                      <button
                        onClick={() => setCurrentStep('upload')}
                        className="flex items-center space-x-2 text-blue-600 font-medium hover:text-blue-700 bg-blue-50 px-4 py-2 rounded-lg"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>處理新檔案</span>
                      </button>
                   </div>
                )}
              </div>

              {/* RIGHT PANEL: OUTPUT */}
              <div className="flex flex-col space-y-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-full overflow-hidden">
                 <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="text-lg font-semibold text-slate-700 flex items-center">
                      <span className="bg-slate-100 text-slate-600 w-8 h-8 flex items-center justify-center rounded-full mr-3 text-sm">3</span>
                      格式化結果 (一律轉為未稅)
                    </h2>

                    <div className="flex items-center space-x-3">
                       {calculatedData && (
                        <button
                          onClick={copyTableToClipboard}
                          className={`
                            px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 transition-all
                            ${copySuccess ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}
                          `}
                        >
                          {copySuccess ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          <span>{copySuccess ? '已複製！' : '一鍵複製表格'}</span>
                        </button>
                      )}
                    </div>
                 </div>

                 <div className="flex-1 border rounded-xl overflow-auto bg-slate-50 relative">
                   {!calculatedData ? (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                        <FileSpreadsheet className="w-16 h-16 mb-4 opacity-20" />
                        <p>
                          {currentStep === 'mapping' ? '設定對應中...' : '等待生成...'}
                        </p>
                     </div>
                   ) : (
                     <div className="p-4 flex justify-center">
                       <table
                          ref={tableRef}
                          className="text-base bg-white border-2 border-black border-collapse"
                          style={{ fontFamily: 'Arial, "Microsoft JhengHei", sans-serif', width: '100%', maxWidth: '800px' }}
                        >
                          <thead>
                            <tr className="text-black font-bold text-center">
                              <th className="p-2 border border-black w-[50%] text-lg">品名</th>
                              <th className="p-2 border border-black w-[10%] text-lg">數量</th>
                              <th className="p-2 border border-black w-[20%] text-lg">單價</th>
                              <th className="p-2 border border-black w-[20%] text-lg">小計</th>
                            </tr>
                          </thead>
                          <tbody>
                            {calculatedData.items.map((item, index) => (
                              <tr key={index}>
                                <td className="p-2 border border-black font-semibold">{item.name}</td>
                                <td className="p-2 border border-black text-center text-lg">{item.quantity}</td>
                                <td className="p-2 border border-black text-center text-lg">
                                  {calcPriority === 'unit'
                                    ? item.unitPrice.toLocaleString('zh-TW', { minimumFractionDigits: roundingPrecision, maximumFractionDigits: roundingPrecision })
                                    : formatUnitPrice(item.unitPrice)
                                  }
                                </td>
                                <td className="p-2 border border-black text-center text-lg">{formatCurrency(item.subtotal)}</td>
                              </tr>
                            ))}

                            {/* Footer / Totals Section */}
                            <tr>
                              <td className="border border-black border-b-0"></td>
                              <td className="border border-black border-b-0"></td>
                              <td className="border border-black text-center text-lg font-bold p-2">未稅合計</td>
                              <td className="border border-black text-center text-lg p-2 font-bold">{formatCurrency(calculatedData.preTaxTotal)}</td>
                            </tr>

                            <tr>
                              <td className="border border-black border-t-0 border-b-0"></td>
                              <td className="border border-black border-t-0 border-b-0"></td>
                              <td className="border border-black text-center text-lg font-bold p-2">稅額</td>
                              <td className="border border-black text-center text-lg p-2 font-bold">{formatCurrency(calculatedData.taxAmount)}</td>
                            </tr>

                            <tr>
                              <td className="border border-black border-t-0"></td>
                              <td className="border border-black border-t-0"></td>
                              <td className="border border-black text-center text-lg font-bold p-2">含稅合計</td>
                              <td className="border border-black text-center text-lg p-2 font-bold">{formatCurrency(calculatedData.totalWithTax)}</td>
                            </tr>
                          </tbody>
                       </table>
                     </div>
                   )}
                 </div>
              </div>
           </div>
        )}
      </main>
    </div>
  );
};

export default App;
