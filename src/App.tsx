import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  Send, Bot, User, Trash2, Sparkles, Loader2, Moon, Sun, 
  ImageIcon, X, Copy, Check, Menu, Plus, Settings, Mic, MicOff, Square,
  Download, Volume2, Globe, Search, MessageSquare, AlertTriangle, ChevronDown, Bell, Gift
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = error => reject(error);
  });
};

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button 
      onClick={handleCopy} 
      className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      title="Copy message"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
    </button>
  );
};

const TTSButton = ({ text }: { text: string }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleSpeak = () => {
    if (!('speechSynthesis' in window)) return;
    
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    return () => {
      if (isSpeaking) window.speechSynthesis.cancel();
    };
  }, [isSpeaking]);

  return (
    <button 
      onClick={handleSpeak} 
      className={cn(
        "p-1.5 rounded-md transition-colors",
        isSpeaking 
          ? "text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" 
          : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      )}
      title={isSpeaking ? "Stop speaking" : "Read aloud"}
    >
      <Volume2 className={cn("w-4 h-4", isSpeaking && "animate-pulse")} />
    </button>
  );
};

type Attachment = {
  file: File;
  url: string;
  base64: string;
  mimeType: string;
};

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  images?: { url: string; base64: string; mimeType: string }[];
  isError?: boolean;
  timestamp?: number;
  groundingChunks?: any[];
  isImageGeneration?: boolean;
};

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

type AppSettings = {
  systemInstruction: string;
  model: string;
  enableSearch: boolean;
};

const DEFAULT_SETTINGS: AppSettings = {
  systemInstruction: 'You are Nova, an intelligent, concise, and helpful AI assistant. Format your responses using Markdown when appropriate.',
  model: 'gemini-3.1-pro-preview',
  enableSearch: false
};

const PERSONAS = [
  { name: 'Default Assistant', prompt: 'You are Nova, an intelligent, concise, and helpful AI assistant. Format your responses using Markdown when appropriate.' },
  { name: 'Expert Programmer', prompt: 'You are an expert software engineer. Provide robust, well-documented, and optimal code. Always explain your technical choices clearly.' },
  { name: 'Creative Writer', prompt: 'You are a creative writing assistant. Help brainstorm, write, and refine stories, poems, and creative text with vivid imagery and engaging narrative.' },
  { name: 'Academic Tutor', prompt: 'You are an academic tutor. Explain concepts clearly, step-by-step, using the Socratic method when appropriate to guide the user to the answer without just giving it away.' }
];

export default function App() {
  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isRecording, setIsRecording] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);

  // Derived state
  const currentSession = sessions.find(s => s.id === currentSessionId) || null;
  const messages = currentSession?.messages || [];
  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.messages.some(m => m.text.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Load data on mount
  useEffect(() => {
    const savedSessions = localStorage.getItem('novachat_sessions');
    const savedSettings = localStorage.getItem('novachat_settings');
    const savedTheme = localStorage.getItem('novachat_theme');

    if (savedSessions) {
      try {
        const parsed = JSON.parse(savedSessions);
        setSessions(parsed);
        if (parsed.length > 0 && !currentSessionId) setCurrentSessionId(parsed[0].id);
      } catch (e) { console.error('Failed to parse sessions', e); }
    }
    
    if (savedSettings) {
      try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }); } 
      catch (e) { console.error('Failed to parse settings', e); }
    }

    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDark(true);
    }

    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      
      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setInput(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, []);

  // Save data on change
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('novachat_sessions', JSON.stringify(sessions));
    } else {
      localStorage.removeItem('novachat_sessions');
    }
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('novachat_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('novachat_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('novachat_theme', 'light');
    }
  }, [isDark]);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]); // Scroll on new message

  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollBottom(!isNearBottom);
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleNewChat = () => {
    setCurrentSessionId(null);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
  };

  const handleClearAllChats = () => {
    setSessions([]);
    setCurrentSessionId(null);
    setShowClearConfirm(false);
    setIsSettingsOpen(false);
  };

  const handleExportChat = () => {
    if (!currentSession || currentSession.messages.length === 0) return;
    
    let markdown = `# ${currentSession.title}\n\n`;
    currentSession.messages.forEach(msg => {
      markdown += `### ${msg.role === 'user' ? 'You' : 'Nova'}\n\n${msg.text}\n\n---\n\n`;
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSession.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'chat'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const newAttachments: Attachment[] = [];
    
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        newAttachments.push({
          file,
          url: URL.createObjectURL(file),
          base64,
          mimeType: file.type
        });
      } catch (err) {
        console.error('Error reading file:', err);
      }
    }
    
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const newAtt = [...prev];
      URL.revokeObjectURL(newAtt[index].url);
      newAtt.splice(index, 1);
      return newAtt;
    });
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const generateTitle = async (firstMessage: string, sessionId: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Generate a very short, concise title (max 4 words) for a chat that starts with this message: "${firstMessage}". Do not use quotes in the output.`,
      });
      if (response.text) {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: response.text.trim() } : s));
      }
    } catch (e) {
      console.error('Failed to generate title', e);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const userText = input.trim();
    const currentAttachments = [...attachments];
    
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      text: userText,
      images: currentAttachments.map(a => ({ url: a.url, base64: a.base64, mimeType: a.mimeType })),
      timestamp: Date.now()
    };
    
    const modelMsgId = (Date.now() + 1).toString();
    const modelMsg: Message = { id: modelMsgId, role: 'model', text: '', timestamp: Date.now() };

    // Create or update session
    let sessionId = currentSessionId;
    let isFirstMessage = false;

    if (!sessionId) {
      isFirstMessage = true;
      sessionId = Date.now().toString();
      const newTitle = userText.split(' ').slice(0, 4).join(' ') + (userText.split(' ').length > 4 ? '...' : '') || 'New Chat';
      const newSession: ChatSession = {
        id: sessionId,
        title: newTitle,
        messages: [userMsg, modelMsg],
        updatedAt: Date.now()
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(sessionId);
    } else {
      setSessions(prev => prev.map(s => 
        s.id === sessionId 
          ? { ...s, messages: [...s.messages, userMsg, modelMsg], updatedAt: Date.now() } 
          : s
      ));
    }

    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Construct history
      const history = (currentSession?.messages || []).map(m => ({
        role: m.role,
        parts: [
          ...(m.text ? [{ text: m.text }] : []),
          ...(m.images ? m.images.map(img => ({ inlineData: { data: img.base64, mimeType: img.mimeType } })) : [])
        ]
      }));

      // Add current message
      history.push({
        role: 'user',
        parts: [
          ...(userText ? [{ text: userText }] : []),
          ...(currentAttachments.length > 0 ? currentAttachments.map(a => ({ inlineData: { data: a.base64, mimeType: a.mimeType } })) : [])
        ]
      });

      if (userText.startsWith('/imagine ')) {
        const prompt = userText.replace('/imagine ', '');
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: { parts: [{ text: prompt }] },
          config: {
            imageConfig: {
              aspectRatio: "1:1",
              imageSize: "1K"
            }
          }
        });

        const images = [];
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            const base64EncodeString = part.inlineData.data;
            const imageUrl = `data:${part.inlineData.mimeType};base64,${base64EncodeString}`;
            images.push({ url: imageUrl, base64: base64EncodeString, mimeType: part.inlineData.mimeType });
          }
        }

        setSessions(prev => prev.map(s => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map(msg => 
              msg.id === modelMsgId ? { ...msg, text: "Here is your image:", images, isImageGeneration: true } : msg
            )
          };
        }));
        scrollToBottom();
      } else {
        const responseStream = await ai.models.generateContentStream({
          model: settings.model,
          contents: history,
          config: {
            systemInstruction: settings.systemInstruction,
            tools: settings.enableSearch ? [{ googleSearch: {} }] : undefined,
          }
        });
        
        for await (const chunk of responseStream) {
          if (abortControllerRef.current?.signal.aborted) break;
          
          const newChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          
          if (chunk.text || newChunks.length > 0) {
            setSessions(prev => prev.map(s => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                messages: s.messages.map(msg => {
                  if (msg.id === modelMsgId) {
                    const existingChunks = msg.groundingChunks || [];
                    // Avoid duplicates by simple check (could be improved, but usually chunks come once or appended)
                    const mergedChunks = [...existingChunks];
                    newChunks.forEach((nc: any) => {
                      if (!mergedChunks.find(ec => ec.web?.uri === nc.web?.uri)) {
                        mergedChunks.push(nc);
                      }
                    });
                    return { 
                      ...msg, 
                      text: msg.text + (chunk.text || ''),
                      groundingChunks: mergedChunks.length > 0 ? mergedChunks : undefined
                    };
                  }
                  return msg;
                })
              };
            }));
            scrollToBottom();
          }
        }
      }

      // Generate smart title in background if it's the first message
      if (isFirstMessage && userText) {
        generateTitle(userText, sessionId);
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation stopped by user');
      } else {
        console.error('Chat error:', error);
        setSessions(prev => prev.map(s => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map(msg => 
              msg.id === modelMsgId 
                ? { ...msg, text: msg.text || 'Sorry, I encountered an error while processing your request.', isError: true } 
                : msg
            )
          };
        }));
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-200 overflow-hidden">
      
      {/* Sidebar Overlay (Mobile) */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-20 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ x: isSidebarOpen ? 0 : -300 }}
        className={cn(
          "fixed md:static inset-y-0 left-0 z-30 w-72 bg-zinc-100 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-300 ease-in-out md:transform-none",
          !isSidebarOpen && "md:translate-x-0 -translate-x-full"
        )}
      >
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button 
              onClick={handleNewChat}
              className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden ml-2 p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filteredSessions.length === 0 ? (
            <div className="text-center text-zinc-500 dark:text-zinc-400 mt-10 flex flex-col items-center gap-2">
              <MessageSquare className="w-8 h-8 opacity-20" />
              <p className="text-sm">{searchQuery ? 'No chats found' : 'No recent chats'}</p>
            </div>
          ) : (
            filteredSessions.map(session => (
              <div 
                key={session.id}
                onClick={() => {
                  setCurrentSessionId(session.id);
                  if (window.innerWidth < 768) setIsSidebarOpen(false);
                }}
                className={cn(
                  "group flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-colors",
                  currentSessionId === session.id 
                    ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-900 dark:text-indigo-100" 
                    : "hover:bg-zinc-200 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300"
                )}
              >
                <div className="truncate text-sm font-medium pr-2 flex-1">
                  {session.title}
                </div>
                <button 
                  onClick={(e) => handleDeleteChat(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-400 hover:text-red-500 rounded-md hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 shadow-sm z-10 transition-colors duration-200 absolute top-0 left-0 right-0">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="p-1.5 bg-indigo-600 dark:bg-indigo-500 rounded-lg shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-100 truncate max-w-[200px] sm:max-w-md">
              {currentSession?.title || 'AiNovaChat.com'}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsWhatsNewOpen(true)}
              className="p-2 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors hidden sm:block"
              title="What's New"
            >
              <Gift className="w-5 h-5" />
            </button>
            {currentSession && currentSession.messages.length > 0 && (
              <button
                onClick={handleExportChat}
                className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors hidden sm:block"
                title="Export Chat to Markdown"
              >
                <Download className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setIsDark(!isDark)}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="Toggle theme"
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <main 
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 sm:p-6 pt-20 pb-32"
        >
          <div className="max-w-4xl mx-auto space-y-8">
            {!currentSession || currentSession.messages.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="flex flex-col items-center justify-center h-[60vh] text-center space-y-5"
              >
                <div className="p-5 bg-indigo-50 dark:bg-indigo-500/10 rounded-full shadow-sm">
                  <Bot className="w-14 h-14 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h2 className="text-3xl font-semibold text-zinc-800 dark:text-zinc-100 tracking-tight">How can I help you today?</h2>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-md text-lg">
                  I'm Nova, an advanced AI assistant powered by Novachat 1. Ask me anything, upload images, or generate code.
                </p>
                {settings.enableSearch && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full text-sm font-medium border border-emerald-200 dark:border-emerald-500/20">
                    <Globe className="w-4 h-4" />
                    Web Search Enabled
                  </div>
                )}
              </motion.div>
            ) : (
              currentSession.messages.map((msg) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={cn(
                    "flex gap-3 sm:gap-4 w-full group",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === 'model' && (
                    <div className="flex-shrink-0 w-8 h-8 mt-1 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/30">
                      <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                  )}
                  
                  <div className={cn("flex flex-col gap-1 max-w-[85%] sm:max-w-[80%]", msg.role === 'user' ? "items-end" : "items-start")}>
                    <div className="flex items-center gap-2 px-1 mb-1">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {msg.role === 'user' ? 'You' : 'Nova'}
                      </span>
                      {msg.timestamp && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                          {formatTime(msg.timestamp)}
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        "px-4 sm:px-5 py-3 sm:py-4 rounded-2xl shadow-sm relative",
                        msg.role === 'user' 
                          ? "bg-indigo-600 dark:bg-indigo-500 text-white rounded-tr-sm" 
                          : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-tl-sm w-full",
                        msg.isError && "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
                      )}
                    >
                      {/* Images */}
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {msg.images.map((img, i) => (
                            <img key={i} src={img.url} alt="Uploaded content" className="max-w-full sm:max-w-[250px] max-h-[250px] object-cover rounded-xl border border-zinc-200/20 shadow-sm" />
                          ))}
                        </div>
                      )}

                      {/* Text Content */}
                      {msg.role === 'user' ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      ) : (
                        <div className="prose prose-zinc dark:prose-invert prose-sm sm:prose-base max-w-none prose-p:leading-relaxed">
                          {msg.text ? (
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                code({node, inline, className, children, ...props}: any) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  return !inline && match ? (
                                    <div className="relative group/code mt-4 mb-4 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                                      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                                        <span>{match[1]}</span>
                                        <CopyButton text={String(children)} />
                                      </div>
                                      <SyntaxHighlighter
                                        style={vscDarkPlus}
                                        language={match[1]}
                                        PreTag="div"
                                        customStyle={{ margin: 0, borderRadius: 0, background: isDark ? '#000' : '#1e1e1e' }}
                                        {...props}
                                      >
                                        {String(children).replace(/\n$/, '')}
                                      </SyntaxHighlighter>
                                    </div>
                                  ) : (
                                    <code className={cn("bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md font-mono text-sm before:content-none after:content-none text-indigo-600 dark:text-indigo-400", className)} {...props}>
                                      {children}
                                    </code>
                                  );
                                }
                              }}
                            >
                              {msg.text}
                            </ReactMarkdown>
                          ) : (
                            <div className="flex items-center gap-1 h-6">
                              <span className="w-2 h-2 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-2 h-2 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-2 h-2 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Grounding Chunks (Sources) */}
                      {msg.role === 'model' && msg.groundingChunks && msg.groundingChunks.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1">
                            <Globe className="w-3 h-3" /> Sources
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {msg.groundingChunks.map((chunk, i) => {
                              if (!chunk.web?.uri) return null;
                              return (
                                <a 
                                  key={i} 
                                  href={chunk.web.uri} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 transition-colors border border-zinc-200 dark:border-zinc-700/50 max-w-[200px] sm:max-w-[300px]"
                                  title={chunk.web.title}
                                >
                                  <span className="truncate">{chunk.web.title || chunk.web.uri}</span>
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Actions (Copy, TTS) */}
                    {msg.role === 'model' && msg.text && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 pl-1 mt-1">
                        <CopyButton text={msg.text} />
                        <TTSButton text={msg.text} />
                      </div>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="flex-shrink-0 w-8 h-8 mt-1 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center border border-zinc-300 dark:border-zinc-700">
                      <User className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                    </div>
                  )}
                </motion.div>
              ))
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </main>

        {/* Scroll to bottom button */}
        <AnimatePresence>
          {showScrollBottom && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={scrollToBottom}
              className="absolute bottom-32 right-8 p-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg text-zinc-500 hover:text-indigo-600 z-10"
            >
              <ChevronDown className="w-5 h-5" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Input Area */}
        <footer className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-50 via-zinc-50 to-transparent dark:from-zinc-950 dark:via-zinc-950 p-4 sm:p-6 pt-10 transition-colors duration-200">
          <div className="max-w-4xl mx-auto">
            <div className="relative flex flex-col bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-2xl shadow-lg focus-within:ring-2 focus-within:ring-indigo-500 dark:focus-within:ring-indigo-400 focus-within:border-transparent transition-all">
              
              {/* Image Attachments Preview */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-3 p-3 border-b border-zinc-200 dark:border-zinc-800">
                  {attachments.map((att, i) => (
                    <div key={i} className="relative group">
                      <img src={att.url} alt="attachment" className="w-16 h-16 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm" />
                      <button
                        onClick={() => removeAttachment(i)}
                        className="absolute -top-2 -right-2 bg-zinc-800 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-zinc-700"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-1 sm:gap-2 p-2">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect} 
                  className="hidden" 
                  accept="image/*" 
                  multiple 
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-shrink-0 p-2.5 text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition-colors mb-1"
                  title="Attach images"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>

                {('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) && (
                  <button
                    onClick={toggleRecording}
                    className={cn(
                      "flex-shrink-0 p-2.5 rounded-xl transition-colors mb-1",
                      isRecording 
                        ? "text-red-500 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20" 
                        : "text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                    )}
                    title={isRecording ? "Stop recording" : "Start recording"}
                  >
                    {isRecording ? <MicOff className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
                  </button>
                )}

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isRecording ? "Listening..." : "Message Nova..."}
                  className="flex-1 max-h-[200px] bg-transparent border-none outline-none resize-none py-2.5 px-2 focus:ring-0 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500"
                  rows={1}
                />
                
                {isLoading ? (
                  <button
                    onClick={stopGeneration}
                    className="flex-shrink-0 p-2.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors shadow-sm mb-1"
                    title="Stop generating"
                  >
                    <Square className="w-5 h-5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && attachments.length === 0)}
                    className="flex-shrink-0 p-2.5 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50 disabled:hover:bg-indigo-600 dark:disabled:hover:bg-indigo-500 transition-colors shadow-sm mb-1"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-3">
              Nova can make mistakes. Consider verifying important information.
            </p>
          </div>
        </footer>
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Settings</h2>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6 overflow-y-auto">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    AI Model
                  </label>
                  <select 
                    value={settings.model}
                    onChange={(e) => setSettings({...settings, model: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="gemini-3.1-pro-preview">Novachat 1 (Best for complex tasks)</option>
                    <option value="gemini-3-flash-preview">Novachat 1 Fast (Faster, good for general chat)</option>
                  </select>
                </div>
                
                <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 dark:bg-emerald-500/20 rounded-lg">
                      <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Web Search Grounding</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Allow Nova to search the web for real-time info.</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={settings.enableSearch}
                      onChange={(e) => setSettings({...settings, enableSearch: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      System Instructions (Persona)
                    </label>
                    <select 
                      onChange={(e) => {
                        const persona = PERSONAS.find(p => p.name === e.target.value);
                        if (persona) setSettings({...settings, systemInstruction: persona.prompt});
                      }}
                      className="text-xs bg-transparent border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 text-zinc-600 dark:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">Quick Select...</option>
                      {PERSONAS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <textarea 
                    value={settings.systemInstruction}
                    onChange={(e) => setSettings({...settings, systemInstruction: e.target.value})}
                    className="w-full h-32 px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-zinc-900 dark:text-zinc-100 text-sm"
                    placeholder="Tell Nova how to behave..."
                  />
                </div>

                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  {showClearConfirm ? (
                    <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl space-y-3">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-sm font-medium text-red-800 dark:text-red-200">Clear all chat history?</h4>
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">This action cannot be undone. All your conversations will be permanently deleted.</p>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button 
                          onClick={() => setShowClearConfirm(false)}
                          className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={handleClearAllChats}
                          className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                        >
                          Yes, delete everything
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Clear all chat history
                    </button>
                  )}
                </div>
              </div>
              
              <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-950/50 border-t border-zinc-200 dark:border-zinc-800 flex justify-end shrink-0">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* What's New Modal */}
      <AnimatePresence>
        {isWhatsNewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWhatsNewOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
                  <Gift className="w-5 h-5 text-indigo-500" /> What's New in AiNovaChat.com (Nova 1.2)
                </h2>
                <button 
                  onClick={() => setIsWhatsNewOpen(false)}
                  className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-full flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Nova 1.2 Big Update</h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Welcome to Nova 1.2! We've added powerful new capabilities to make your AI experience even better.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center">
                      <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Web Search Sources</h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">When Nova searches the web, you can now see and click the exact source links used to generate your answer.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI Image Generation</h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Type <code>/imagine</code> followed by your prompt to generate stunning images directly in the chat!</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-full flex items-center justify-center">
                      <Volume2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Voice Input & TTS</h3>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Speak to Nova using the microphone button, and listen to responses with the speaker icon.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-950/50 border-t border-zinc-200 dark:border-zinc-800 flex justify-end shrink-0">
                <button 
                  onClick={() => setIsWhatsNewOpen(false)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                >
                  Awesome!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
