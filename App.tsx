
import React, { useState, useEffect, useRef } from 'react';
import ImageUploader from './components/ImageUploader';
import GeneratedImage from './components/GeneratedImage';
import { AppStatus, UploadedImage, GenerationResult, Preset } from './types';
import { generateImageFromReference, enhancePrompt as enhancePromptService, analyzePlanGeometry } from './services/geminiService';
import { Wand2, Sparkles, Zap, Cpu, Settings2, ImagePlus, Globe, Key, Brush, Undo, Redo, RefreshCw, PenTool, Image as ImageIcon, Loader2, RotateCcw, ChevronDown, ChevronRight, AlertTriangle, Palette } from 'lucide-react';
import { TRANSLATIONS, EXTERIOR_PRESETS, INTERIOR_PRESETS, PLAN_PRESETS } from './constants';

// --- TYPE DECLARATIONS ---
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
  namespace NodeJS {
    interface ProcessEnv {
      API_KEY?: string;
    }
  }
}

// Helper to safely get API key from environment without crashing
const getEnvApiKey = (): string | undefined => {
  try {
    return process.env.API_KEY;
  } catch (e) {
    return undefined;
  }
};

const App: React.FC = () => {
  // --- APP STATE ---
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [selectedImage, setSelectedImage] = useState<UploadedImage | null>(null);
  const [styleImage, setStyleImage] = useState<UploadedImage | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'EXTERIOR' | 'INTERIOR' | 'PLAN'>('EXTERIOR');
  const [prompt, setPrompt] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  
  // Initialize from localStorage
  const [manualApiKey, setManualApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  
  const [model, setModel] = useState('gemini-3-pro-optimized'); 
  const [language, setLanguage] = useState<'EN' | 'TH'>('TH');
  const [activePresets, setActivePresets] = useState<Preset[]>(EXTERIOR_PRESETS);
  
  const [artStyle, setArtStyle] = useState<string>('stylePhoto');
  const [isStyleExpanded, setIsStyleExpanded] = useState(false);
  
  const [isMaskMode, setIsMaskMode] = useState(false);
  const [maskData, setMaskData] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(20);
  const [brushColor, setBrushColor] = useState('#ef4444');
  const [triggerUndo, setTriggerUndo] = useState(0);

  const [resetKey, setResetKey] = useState(0);
  const [resultHistory, setResultHistory] = useState<GenerationResult[]>([]);
  const [redoStack, setRedoStack] = useState<GenerationResult[]>([]);

  // Update presets when tab changes
  useEffect(() => {
    setSelectedPresetId(null);
    setExpandedGroupId(null);
    if (tab === 'EXTERIOR') setActivePresets(EXTERIOR_PRESETS);
    else if (tab === 'INTERIOR') setActivePresets(INTERIOR_PRESETS);
    else if (tab === 'PLAN') {
      setActivePresets(PLAN_PRESETS);
      setExpandedGroupId('plan-group-quick');
    }
  }, [tab]);

  const t = TRANSLATIONS[language];
  const envKey = getEnvApiKey();
  const isProUnlocked = !!manualApiKey;

  // --- HELPER TO FIND PRESET PROMPT ---
  const findPresetPrompt = (presets: Preset[], id: string): string | null => {
    for (const p of presets) {
        if (p.id === id) return p.prompt;
        if (p.children) {
            const found = findPresetPrompt(p.children, id);
            if (found) return found;
        }
    }
    return null;
  };

  // --- HANDLERS ---
  
  const handleSaveApiKey = () => {
    if (manualApiKey) {
        localStorage.setItem('gemini_api_key', manualApiKey);
    } else {
        localStorage.removeItem('gemini_api_key');
    }
    alert(t.keySaved);
  };

  const handleEnhancePrompt = async () => {
    // If prompt is empty but preset selected, use preset prompt
    let textToEnhance = prompt.trim();
    if (!textToEnhance && selectedPresetId) {
        const presetPrompt = findPresetPrompt(activePresets, selectedPresetId);
        if (presetPrompt) textToEnhance = presetPrompt;
    }

    if (!textToEnhance) return alert(t.enterPrompt);
    const keyToUse = manualApiKey || envKey;

    if (!keyToUse && !window.aistudio) return alert(t.enterKey);

    setIsEnhancing(true);
    try {
        const enhanced = await enhancePromptService(textToEnhance, keyToUse);
        setPrompt(enhanced);
    } catch (e) { console.error(e); } finally { setIsEnhancing(false); }
  };

  const handlePresetClick = (preset: Preset) => {
      if (preset.children) {
          setExpandedGroupId(expandedGroupId === preset.id ? null : preset.id);
      } else {
          if (selectedPresetId === preset.id) {
             setSelectedPresetId(null);
          } else {
             setSelectedPresetId(preset.id);
             // Note: We deliberately DO NOT setPrompt(preset.prompt) here to keep UI clean
          }
      }
  };

  const handleGenerate = async () => {
    setStatus(AppStatus.LOADING);
    setError(null);

    let keyToUse = manualApiKey || envKey;
    
    if (!keyToUse) {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            if (!hasKey) try { await window.aistudio.openSelectKey(); } catch {}
        } else {
             alert(t.enterKey);
             setStatus(AppStatus.IDLE);
             return;
        }
    }
    
    let sourceImageToUse: UploadedImage | null = selectedImage;
    if (result?.imageUrl && (additionalPrompt.trim() || maskData)) {
       sourceImageToUse = { base64: result.imageUrl, mimeType: 'image/png' };
    }

    if (!sourceImageToUse) {
        alert("Please upload an image first.");
        setStatus(AppStatus.IDLE);
        return;
    }

    let planContext = "";
    if (tab === 'PLAN' && !result && !maskData) {
        try {
            planContext = await analyzePlanGeometry(sourceImageToUse.base64, sourceImageToUse.mimeType, keyToUse);
        } catch (e) {
            console.warn("Plan analysis skipped", e);
        }
    }
    
    let finalPrompt = "";
    if (planContext) {
        finalPrompt += `[CONTEXT: ${planContext}] `;
    }

    // Determine effective user prompt
    let effectiveUserPrompt = prompt.trim();
    
    // If no custom prompt is typed, try to get from selected preset
    if (!effectiveUserPrompt && selectedPresetId) {
        const presetPrompt = findPresetPrompt(activePresets, selectedPresetId);
        if (presetPrompt) {
            effectiveUserPrompt = presetPrompt;
        }
    }

    if (effectiveUserPrompt) {
        if (finalPrompt) finalPrompt += " ";
        finalPrompt += effectiveUserPrompt;
    }

    if (additionalPrompt.trim()) {
      finalPrompt += ` \nRefinement Note: ${additionalPrompt}`;
    }
    
    let stylePrompt = "";
    switch (artStyle) {
          case 'styleOil': stylePrompt = "Style: Oil Painting on Canvas, textured brushwork, artistic masterpiece."; break;
          case 'stylePencil': stylePrompt = "Style: Graphite Pencil Sketch on paper, monochrome, hand-drawn, hatching details."; break;
          case 'styleMarker': stylePrompt = "Style: Architectural Marker Rendering, alcohol marker style, vibrant colors, hand-drawn."; break;
          case 'styleColorPencil': stylePrompt = "Style: Colored Pencil Drawing, soft shading, artistic hand-drawn texture."; break;
          case 'styleAnime': stylePrompt = "Style: Anime Art, vibrant colors, detailed background, Makoto Shinkai style, high resolution."; break;
          case 'stylePhoto': default: stylePrompt = ""; break;
    }
    if (stylePrompt) {
        finalPrompt += ` \n${stylePrompt}`;
    }

    if (!finalPrompt.trim()) {
        alert(t.enterPrompt);
        setStatus(AppStatus.IDLE);
        return;
    }
    
    let selectedModel = model;
    let targetResolution: '1K' | '2K' | '4K' = '1K';
    const hasUserKey = !!manualApiKey; 
    
    if (!hasUserKey) {
        if (selectedModel === 'gemini-3-pro-image-preview' || selectedModel === 'gemini-3-pro-ultra-4k') {
             selectedModel = 'gemini-2.5-flash-image'; 
             targetResolution = '1K';
        }
    }

    if (selectedModel === 'gemini-3-pro-ultra-4k') {
        selectedModel = 'gemini-3-pro-image-preview';
        targetResolution = '4K';
    } else if (selectedModel === 'gemini-3-pro-image-preview') {
         targetResolution = '2K';
    } else if (selectedModel === 'gemini-3-pro-optimized') {
        selectedModel = 'gemini-2.5-flash-image';
        targetResolution = '1K';
    }

    try {
      const genResult = await generateImageFromReference(
        sourceImageToUse.base64,
        sourceImageToUse.mimeType,
        finalPrompt,
        selectedModel,
        styleImage,
        maskData,
        keyToUse,
        targetResolution
      );
      
      // Update History Logic: Store result, clear Redo stack on new generation
      if (result) {
          setResultHistory(prev => [...prev, result]);
          setRedoStack([]); // Clear redo stack because we branched off
      }
      
      setResult(genResult);
      setStatus(AppStatus.SUCCESS);
      setIsMaskMode(false);
      setMaskData(null);
    } catch (e: any) {
      console.error(e);
      setError(e.message || t.unexpectedError);
      setStatus(AppStatus.ERROR);
      if (e.message && (e.message.includes('403') || e.message.includes('Permission'))) {
         if (window.aistudio && !manualApiKey) {
            if (confirm("Permission Denied. Select new Key?")) {
                try { await window.aistudio.openSelectKey(); } catch {}
            }
         }
      }
    }
  };

  const handleNewProject = () => {
    setResetKey(p => p + 1);
    setPrompt('');
    setSelectedPresetId(null);
    setExpandedGroupId(null);
    setAdditionalPrompt('');
    setResult(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    setIsMaskMode(false);
    setMaskData(null);
    setStyleImage(null);
    setSelectedImage(null);
    setIsEnhancing(false);
    setTab('EXTERIOR');
    setBrushSize(20);
    setTriggerUndo(0);
    setResultHistory([]);
    setRedoStack([]);
    setArtStyle('stylePhoto');
  };

  const handleResetResult = () => {
     setResult(null);
     setStatus(AppStatus.IDLE);
     setError(null);
     setIsMaskMode(false);
     setMaskData(null);
  }
  
  const handleUndoResult = () => {
      if (resultHistory.length > 0) {
          const previous = resultHistory[resultHistory.length - 1];
          const newHistory = resultHistory.slice(0, -1);
          
          if (result) {
             setRedoStack(prev => [result, ...prev]);
          }
          
          setResult(previous);
          setResultHistory(newHistory);
      }
  };

  const handleRedoResult = () => {
      if (redoStack.length > 0) {
          const next = redoStack[0];
          const newRedo = redoStack.slice(1);
          
          if (result) {
              setResultHistory(prev => [...prev, result]);
          }
          
          setResult(next);
          setRedoStack(newRedo);
      }
  };

  const getPromptPlaceholder = () => {
    return t.promptPlaceholder;
  };

  const isProModelSelected = model.includes('gemini-3-pro') && !model.includes('optimized');

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-300 font-roboto overflow-hidden">

      <aside className="w-[340px] flex-shrink-0 flex flex-col border-r border-white/10 bg-[#0c1421] z-20 shadow-2xl h-full">
        <div className="p-5 border-b border-white/10 flex-shrink-0 bg-[#0c1421]/95 backdrop-blur z-10 flex flex-col gap-4">
          <div className="flex items-center justify-between">
             <div className="flex items-center gap-3">
               <div className="bg-gradient-to-tr from-blue-500 to-cyan-600 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
                 <Sparkles className="w-5 h-5 text-white" />
               </div>
               <div>
                 <h1 className="text-2xl font-bold text-white tracking-tight leading-none flex items-baseline gap-1">
                   RENDER AI <span className="text-[10px] font-normal text-cyan-400/80">v2.1</span>
                 </h1>
               </div>
             </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* AI SETTINGS */}
          <div className="space-y-1">
             <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-zinc-500 flex items-center gap-1.5 tracking-wider uppercase"><Settings2 size={10}/> {t.aiSettings}</label>
             </div>
             <div className="flex flex-col rounded-lg border border-white/5 bg-black/20 overflow-hidden">
                <div className="relative border-b border-white/5 group">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-hover:text-zinc-400 transition-colors"><Cpu size={12} /></div>
                    <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-transparent text-zinc-300 text-[10px] pl-8 pr-6 py-2 appearance-none focus:bg-white/5 outline-none cursor-pointer font-medium hover:text-white transition-colors">
                      <option value="gemini-3-pro-optimized" className="bg-[#0c1421]">Gemini 3.0 Pro (Optimized)</option>
                      <option value="gemini-3-pro-image-preview" className="bg-[#0c1421]">Gemini 3.0 Pro (2K)</option>
                      <option value="gemini-3-pro-ultra-4k" className="bg-[#0c1421]">Gemini 3.0 Pro (4K)</option>
                      <option value="gemini-2.5-flash-image" className="bg-[#0c1421]">Gemini 2.5 Flash</option>
                    </select>
                     <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-700"><ChevronDown size={10} /></div>
                </div>
                {!isProUnlocked && isProModelSelected && (
                    <div className="bg-yellow-500/10 px-2 py-1 flex items-start gap-1.5 border-b border-white/5">
                        <AlertTriangle size={10} className="text-yellow-500 mt-0.5 shrink-0"/>
                        <p className="text-[9px] text-yellow-200/80 leading-tight">{t.needKeyWarning}</p>
                    </div>
                )}
                <div className="flex items-center bg-black/10 hover:bg-white/5 transition-colors">
                   <button onClick={async () => { if (window.aistudio) try { await window.aistudio.openSelectKey(); } catch {} }} className="flex-1 flex items-center justify-between text-[10px] px-2.5 py-2 text-left" title={t.apiKeyStatus}>
                      <span className="text-zinc-400 font-medium">License</span>
                      <div className={`flex items-center gap-1.5 ${isProUnlocked ? 'text-green-400' : 'text-zinc-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${isProUnlocked ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]' : 'bg-zinc-600'}`}></div>
                            <span className="font-bold">{isProUnlocked ? 'PRO' : 'FREE'}</span>
                      </div>
                   </button>
                   <div className="w-px h-3 bg-white/5 mx-1"></div>
                   <button onClick={() => setShowApiKeyInput(!showApiKeyInput)} className={`p-2 text-zinc-600 hover:text-white transition-colors ${showApiKeyInput ? 'text-cyan-400 bg-cyan-500/10' : ''}`} title="Enter Manual Key"><Key size={10} /></button>
                </div>
                {showApiKeyInput && (
                   <div className="bg-black/40 p-1.5 flex items-center gap-1 animate-in slide-in-from-top-1 border-t border-white/5">
                       <input type="password" value={manualApiKey} onChange={(e) => setManualApiKey(e.target.value)} placeholder="Paste API Key..." className="flex-1 bg-zinc-900/50 text-white text-[10px] px-2 py-1.5 outline-none placeholder-zinc-700 rounded border border-white/5 focus:border-cyan-500/50 transition-colors"/>
                       <button onClick={() => { handleSaveApiKey(); setShowApiKeyInput(false); }} className="px-2 py-1.5 text-[9px] font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/20">SAVE</button>
                   </div>
                )}
             </div>
          </div>

          <div className="flex p-1 bg-black/20 rounded-lg border border-white/5">
            {['EXTERIOR', 'INTERIOR', 'PLAN'].map((tabName) => (
              <button key={tabName} onClick={() => setTab(tabName as any)} className={`flex-1 py-2 text-[10px] font-bold rounded-md transition-all ${tab === tabName ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}`}>
                {t[tabName.toLowerCase() as keyof typeof t] || tabName}
              </button>
            ))}
          </div>

           <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-zinc-400 flex items-center gap-2"><PenTool size={12} /> {t.promptLabel}</label>
              <button onClick={handleEnhancePrompt} disabled={isEnhancing || (!prompt.trim() && !selectedPresetId)} className="flex items-center gap-1 text-[10px] bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 px-2 py-1 rounded transition-colors disabled:opacity-50">
                {isEnhancing ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                {isEnhancing ? t.enhancing : t.enhanceButton}
              </button>
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={getPromptPlaceholder()} className={`w-full h-20 bg-black/20 border rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-600 focus:ring-1 focus:ring-cyan-500 outline-none resize-none transition-colors ${isMaskMode || maskData ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-white/10'}`} />
          </div>

           <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-400 flex items-center gap-2"><Sparkles size={12} /> {t.refineLabel}</label>
            <textarea value={additionalPrompt} onChange={(e) => setAdditionalPrompt(e.target.value)} placeholder={t.refinePlaceholder} className="w-full h-16 bg-black/20 border border-white/10 rounded-lg p-3 text-xs text-zinc-200 placeholder-zinc-600 focus:ring-1 focus:ring-cyan-500 outline-none resize-none" />
          </div>

          <div className="space-y-2">
             <label className="text-xs font-bold text-zinc-400 flex items-center gap-2"><ImageIcon size={12} /> {t.styleReference} <span className="text-zinc-600 text-[10px] ml-auto">{t.optional}</span></label>
             <ImageUploader key={`style-${resetKey}`} onImageSelect={setStyleImage} selectedImage={styleImage} compact />
          </div>

          <div className="bg-black/20 border border-white/10 rounded-lg p-3 space-y-3">
             <div className="flex items-center justify-between cursor-pointer group" onClick={() => setIsStyleExpanded(!isStyleExpanded)}>
                <label className="text-xs font-bold text-zinc-400 flex items-center gap-2 cursor-pointer group-hover:text-white transition-colors"><Palette size={12} /> {t.imageStyle}</label>
                <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isStyleExpanded ? 'rotate-180' : ''}`} />
             </div>
             {isStyleExpanded && (
               <div className="grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1 pt-1">
                  {[
                      { id: 'stylePhoto', icon: <ImageIcon size={12}/> },
                      { id: 'styleAnime', icon: <Sparkles size={12}/> },
                      { id: 'styleOil', icon: <Brush size={12}/> },
                      { id: 'stylePencil', icon: <PenTool size={12}/> },
                      { id: 'styleMarker', icon: <PenTool size={12}/> },
                      { id: 'styleColorPencil', icon: <PenTool size={12}/> }
                  ].map((style) => (
                      <button key={style.id} onClick={() => setArtStyle(style.id)} className={`flex items-center justify-center gap-2 py-2 px-2 rounded-lg text-[10px] font-bold transition-all border ${artStyle === style.id ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' : 'bg-zinc-800 border-white/5 text-zinc-400 hover:bg-zinc-700 hover:text-white'} ${style.id === 'stylePhoto' ? 'col-span-2' : ''}`}>
                         {style.icon} {t[style.id as keyof typeof t]}
                      </button>
                  ))}
               </div>
             )}
          </div>

          <div className="space-y-2">
             <label className="text-xs font-bold text-zinc-400 flex items-center gap-2"><Zap size={12} /> {t.quickPrompts}</label>
             <div className="flex flex-col space-y-2">
                {activePresets.map((preset) => {
                  const isGrid = preset.id === 'int-materials-group' || preset.id === 'int-styles-group' || preset.id === 'plan-group-modes' || preset.id === 'plan-group-quick' || preset.id === 'plan-group-pro-styles' || preset.id === 'plan-materials-group';
                  return (
                  <div key={preset.id} className="flex flex-col">
                      <button onClick={() => handlePresetClick(preset)} className={`group relative w-full h-10 rounded-lg overflow-hidden transition-all duration-300 flex items-center text-left px-3 border ${selectedPresetId === preset.id || expandedGroupId === preset.id ? 'bg-blue-500/20 border-blue-500/50 ring-1 ring-blue-500/50' : 'bg-black/20 hover:bg-black/40 border-white/5 hover:border-blue-500/30'}`}>
                        <div className="flex items-center justify-between w-full gap-2">
                           <span className={`text-xs font-bold truncate ${selectedPresetId === preset.id || expandedGroupId === preset.id ? 'text-blue-300' : 'text-zinc-300 group-hover:text-white'}`}>{preset.label}</span>
                           <div className="flex items-center gap-2 min-w-0 shrink-0">
                               <span className={`text-[10px] font-medium truncate text-right ${selectedPresetId === preset.id || expandedGroupId === preset.id ? 'text-blue-400/70' : 'text-zinc-500 group-hover:text-blue-400'}`}>{language === 'TH' ? preset.thSubtitle : preset.subtitle}</span>
                               {preset.children && (<span className={`opacity-70 ${selectedPresetId === preset.id || expandedGroupId === preset.id ? 'text-blue-300' : 'text-zinc-400'}`}>{expandedGroupId === preset.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>)}
                           </div>
                        </div>
                        {selectedPresetId === preset.id && !preset.children && (<div className="absolute right-2 top-1/2 -translate-y-1/2"><div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_5px_rgba(59,130,246,0.8)]"></div></div>)}
                      </button>
                      {preset.children && expandedGroupId === preset.id && (
                          <div className={`mt-2 ${isGrid ? 'grid grid-cols-2 gap-2 p-1' : 'ml-2 space-y-2 pl-2 border-l border-white/10'}`}>
                             {preset.children.map(child => (
                                 <button key={child.id} onClick={() => { if (selectedPresetId === child.id) { setSelectedPresetId(null); } else { setSelectedPresetId(child.id); } }} className={`group relative w-full rounded-lg overflow-hidden transition-all duration-300 flex items-center text-left border ${selectedPresetId === child.id ? 'bg-blue-500/10 border-blue-500/50' : 'bg-black/10 hover:bg-black/30 border-white/5 hover:border-blue-500/30'} ${isGrid ? 'justify-center py-2 h-auto flex-col gap-0.5' : 'h-9 px-3'}`}>
                                    {isGrid ? (
                                        <div className={`flex flex-col w-full items-center text-center`}><span className={`font-bold truncate text-[10px] ${selectedPresetId === child.id ? 'text-blue-300' : 'text-zinc-400 group-hover:text-white'}`}>{child.label}</span></div>
                                    ) : (
                                        <div className={`flex flex-row items-center justify-between w-full`}><span className={`text-[11px] font-bold truncate ${selectedPresetId === child.id ? 'text-blue-300' : 'text-zinc-400 group-hover:text-white'}`}>{child.label}</span><span className={`text-[10px] truncate text-right ${selectedPresetId === child.id ? 'text-blue-400/70' : 'text-zinc-600 group-hover:text-blue-400'}`}>{language === 'TH' ? child.thSubtitle : child.subtitle}</span></div>
                                    )}
                                    {selectedPresetId === child.id && !isGrid && (<div className="absolute right-2 top-1/2 -translate-y-1/2"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_5px_rgba(59,130,246,0.8)]"></div></div>)}
                                  </button>
                             ))}
                          </div>
                      )}
                  </div>
                )})}
             </div>
          </div>
        </div>

        <div className="p-5 border-t border-white/10 bg-[#0c1421] z-20 flex-shrink-0">
             <button onClick={handleGenerate} disabled={status === AppStatus.LOADING} className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-900/20 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {status === AppStatus.LOADING ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>{t.rendering}</> : <><Wand2 className="w-4 h-4" /> {t.generate}</>}
            </button>
        </div>
      </aside>

      <main className="flex-1 relative bg-zinc-950 overflow-hidden flex flex-col">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(24,24,27,0.8),_rgba(9,9,11,1))] pointer-events-none"></div>
          
          <div className="w-full py-4 z-[100] flex items-center justify-center relative bg-transparent shrink-0">
             <button onClick={handleNewProject} className="flex items-center gap-2 bg-zinc-800 border border-zinc-600 text-zinc-100 hover:text-white hover:bg-zinc-700 px-8 py-3 rounded-full text-sm font-bold transition-all shadow-xl hover:shadow-cyan-500/30 group ring-1 ring-white/10" title={t.startNew}>
                 <RotateCcw size={16} className="text-zinc-400 group-hover:text-cyan-400 transition-colors" /> {t.newProject}
              </button>
             
             <div className="absolute right-6 top-1/2 -translate-y-1/2">
                <button onClick={() => setLanguage(l => l === 'EN' ? 'TH' : 'EN')} className="flex items-center gap-2 bg-zinc-900/50 border border-zinc-700/50 text-zinc-400 hover:text-white px-3 py-1.5 rounded-full text-[10px] font-bold transition-all">
                   <Globe size={12} /> {language}
                 </button>
             </div>
          </div>

          <div className="flex-1 relative w-full overflow-hidden flex items-center justify-center p-4">
             {!selectedImage ? (
                <div className="flex flex-col items-center justify-center w-full h-full max-w-2xl px-4 animate-in fade-in zoom-in-95 duration-300">
                    <div className="text-center mb-8 space-y-2">
                        <div className="w-16 h-16 bg-zinc-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-zinc-700/50 shadow-xl shadow-cyan-500/10">
                           <ImagePlus size={32} className="text-cyan-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">{t.uploadToBegin}</h2>
                        <p className="text-zinc-500 text-sm">Upload a sketch, photo, or floor plan to transform.</p>
                    </div>
                    <div className="w-full">
                       <ImageUploader key={`main-${resetKey}`} onImageSelect={setSelectedImage} selectedImage={selectedImage} />
                    </div>
                </div>
             ) : (
                <GeneratedImage 
                  status={status} result={result} error={error} onReset={handleResetResult} selectedImage={selectedImage}
                  isMaskMode={isMaskMode} brushSize={brushSize} brushColor={brushColor} onMaskChange={setMaskData} triggerUndo={triggerUndo}
                  labels={{ readyToRender: t.readyToRender, uploadToBegin: t.uploadToBegin, aiProcessing: t.aiProcessing, generationFailed: t.generationFailed, somethingWrong: t.somethingWrong }}
                  onUndo={handleUndoResult}
                  onRedo={handleRedoResult}
                  canUndo={resultHistory.length > 0}
                  canRedo={redoStack.length > 0}
                />
             )}
          </div>
      </main>
    </div>
  );
};

export default App;
