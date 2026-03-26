import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Send, User as UserIcon, Users, LogOut, MessageSquare, ChevronLeft, Check, CheckCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { db, auth, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { ref, set, onValue, push, update, serverTimestamp, query, orderByChild, equalTo, onDisconnect } from 'firebase/database';

// Types
interface Message {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  text: string;
  timestamp: number;
  status?: 'sent' | 'delivered' | 'read';
}

interface User {
  id: string;
  name: string;
  photoURL?: string;
  isOnline?: boolean;
  lastSeen?: number;
}

function MessageStatusIndicator({ status }: { status: 'sent' | 'delivered' | 'read' }) {
  return (
    <div className="relative w-4 h-4 flex items-center justify-center ml-1">
      <AnimatePresence mode="wait">
        {status === 'sent' && (
          <motion.div
            key="sent"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
            className="absolute"
          >
            <Check size={14} className="opacity-70" />
          </motion.div>
        )}
        {status === 'delivered' && (
          <motion.div
            key="delivered"
            initial={{ opacity: 0, scale: 0.5, x: -5 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
            className="absolute"
          >
            <CheckCheck size={14} className="opacity-70" />
          </motion.div>
        )}
        {status === 'read' && (
          <motion.div
            key="read"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, type: "spring" }}
            className="absolute"
          >
            <CheckCheck size={14} className="text-blue-500 drop-shadow-[0_0_2px_rgba(59,130,246,0.4)]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatInput({ 
  currentUser,
  selectedUser, 
  onSendMessage 
}: { 
  currentUser: User;
  selectedUser: User; 
  onSendMessage: (text: string) => void;
}) {
  const [inputText, setInputText] = useState('');
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      const chatId = [currentUser.id, selectedUser.id].sort().join('_');
      update(ref(db, `chats/${chatId}`), { [`typing_${currentUser.id}`]: false });
      setInputText('');
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    
    const chatId = [currentUser.id, selectedUser.id].sort().join('_');
    update(ref(db, `chats/${chatId}`), { [`typing_${currentUser.id}`]: true });
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      update(ref(db, `chats/${chatId}`), { [`typing_${currentUser.id}`]: false });
    }, 2000);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 md:gap-4">
      <input
        type="text"
        value={inputText}
        onChange={handleChange}
        dir="auto"
        placeholder={`Message ${selectedUser.name}...`}
        className="flex-1 neu-pressed rounded-2xl px-4 py-3 md:px-6 md:py-4 outline-none text-neu-text placeholder:text-neu-text/50 focus:ring-2 focus:ring-neu-accent/30 transition-all text-sm md:text-base"
      />
      <button
        type="submit"
        disabled={!inputText.trim()}
        className="w-12 h-12 md:w-14 md:h-14 shrink-0 neu-flat hover:neu-convex active:neu-pressed rounded-2xl flex items-center justify-center text-neu-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send size={18} className="ml-1 md:w-5 md:h-5" />
      </button>
    </form>
  );
}

export default function App() {
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [authErrorDomain, setAuthErrorDomain] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [isSelectedUserTyping, setIsSelectedUserTyping] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Authentication State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRef = ref(db, `users/${user.uid}`);
        
        // Setup disconnect hook so they go offline if they close the tab
        onDisconnect(userRef).update({ 
          isOnline: false, 
          lastSeen: serverTimestamp() 
        });

        // Update user profile in DB
        await update(userRef, {
          id: user.uid,
          name: user.displayName || 'User',
          photoURL: user.photoURL || '',
          isOnline: true,
          lastSeen: serverTimestamp()
        });
        
        setCurrentUser({ 
          id: user.uid, 
          name: user.displayName || 'User',
          photoURL: user.photoURL || ''
        });
        setIsJoined(true);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // Handle window close to set offline status
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentUser) {
        update(ref(db, `users/${currentUser.id}`), { isOnline: false, lastSeen: serverTimestamp() });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentUser]);

  // Listen to all users (online and offline)
  useEffect(() => {
    if (!currentUser) return;
    
    const isCurrentUserGuest = currentUser.id.startsWith('guest_');

    const unsub = onValue(ref(db, 'users'), (snap) => {
      const allUsers: User[] = [];
      snap.forEach((childSnap) => {
        const u = childSnap.val() as User;
        if (u.id !== currentUser.id) {
          const isTargetGuest = u.id.startsWith('guest_');
          
          if (isCurrentUserGuest) {
            // Guests only see other online guests
            if (isTargetGuest && u.isOnline) {
              allUsers.push(u);
            }
          } else {
            // Google users only see other Google users
            if (!isTargetGuest) {
              allUsers.push(u);
            }
          }
        }
      });
      // Sort online users first
      allUsers.sort((a, b) => (a.isOnline === b.isOnline) ? 0 : a.isOnline ? -1 : 1);
      setUsers(allUsers);
    });
    return () => unsub();
  }, [currentUser]);

  // Listen to global messages for unread counts and delivery status
  useEffect(() => {
    if (!currentUser) return;
    const q = query(ref(db, 'messages'), orderByChild('receiverId'), equalTo(currentUser.id));
    const unsub = onValue(q, (snap) => {
      const counts: Record<string, number> = {};
      const updates: Record<string, any> = {};
      
      snap.forEach((childSnap) => {
        const msg = childSnap.val() as Message;
        if (msg.status !== 'read') {
          counts[msg.senderId] = (counts[msg.senderId] || 0) + 1;
        }
        if (msg.status === 'sent') {
          updates[`${msg.id}/status`] = 'delivered';
        }
      });
      
      setUnreadCounts(counts);
      if (Object.keys(updates).length > 0) {
        update(ref(db, 'messages'), updates);
      }
    });
    return () => unsub();
  }, [currentUser]);

  // Listen to active chat messages (This automatically loads history!)
  useEffect(() => {
    if (!currentUser || !selectedUser) return;
    const chatId = [currentUser.id, selectedUser.id].sort().join('_');
    const q = query(ref(db, 'messages'), orderByChild('chatId'), equalTo(chatId));
    const unsub = onValue(q, (snap) => {
      const msgs: Message[] = [];
      const updates: Record<string, any> = {};
      
      snap.forEach((childSnap) => {
        const msg = childSnap.val() as Message;
        msgs.push(msg);
        
        // Mark received messages as read
        if (msg.receiverId === currentUser.id && msg.status !== 'read') {
          updates[`${msg.id}/status`] = 'read';
        }
      });
      
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);

      if (Object.keys(updates).length > 0) {
        update(ref(db, 'messages'), updates);
      }
    });
    return () => unsub();
  }, [currentUser, selectedUser]);

  // Listen to typing status
  useEffect(() => {
    if (!currentUser || !selectedUser) {
      setIsSelectedUserTyping(false);
      return;
    }
    const chatId = [currentUser.id, selectedUser.id].sort().join('_');
    const unsub = onValue(ref(db, `chats/${chatId}`), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setIsSelectedUserTyping(!!data[`typing_${selectedUser.id}`]);
      } else {
        setIsSelectedUserTyping(false);
      }
    });
    return () => unsub();
  }, [currentUser, selectedUser]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSelectedUserTyping]);

  const handleGoogleLogin = async () => {
    try {
      setAuthErrorDomain(null);
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Error signing in with Google:", error);
      if (error?.code === 'auth/unauthorized-domain' || error?.message?.includes('unauthorized-domain')) {
        setAuthErrorDomain(window.location.hostname);
      } else {
        alert("Failed to sign in. " + error.message);
      }
    }
  };

  const handleGuestJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guestName.trim()) {
      try {
        const userId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const userRef = ref(db, `users/${userId}`);

        onDisconnect(userRef).update({
          isOnline: false,
          lastSeen: serverTimestamp()
        });

        await update(userRef, {
          id: userId,
          name: guestName.trim(),
          photoURL: '',
          isOnline: true,
          lastSeen: serverTimestamp()
        });

        setCurrentUser({
          id: userId,
          name: guestName.trim(),
          photoURL: ''
        });
        setIsJoined(true);
      } catch (error: any) {
        console.error("Error joining as guest:", error);
        if (error?.message?.includes("permission") || error?.message?.includes("denied")) {
          alert("Permission Denied! To use Guest Mode, you must set your Realtime Database rules to allow read/write for everyone (true).");
        } else {
          alert("Failed to join as guest: " + error.message);
        }
      }
    }
  };

  const selectUser = (user: User) => {
    setSelectedUser(user);
    setMessages([]); // Clear while loading
  };

  const handleLogout = async () => {
    if (currentUser) {
      await update(ref(db, `users/${currentUser.id}`), { 
        isOnline: false, 
        lastSeen: serverTimestamp() 
      });
    }
    if (auth.currentUser) {
      await signOut(auth);
    }
    setIsJoined(false);
    setCurrentUser(null);
    setSelectedUser(null);
    setMessages([]);
    setUnreadCounts({});
  };

  const handleSendMessage = async (text: string) => {
    if (!currentUser || !selectedUser) return;
    try {
      const chatId = [currentUser.id, selectedUser.id].sort().join('_');
      const newMsgRef = push(ref(db, 'messages'));
      const newMessage: Message = {
        id: newMsgRef.key!,
        chatId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        receiverId: selectedUser.id,
        text,
        timestamp: Date.now(),
        status: 'sent'
      };
      await set(newMsgRef, newMessage);
    } catch (error: any) {
      console.error("Error sending message:", error);
      alert("Failed to send message. Check your Realtime Database Security Rules.");
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-neu-accent border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="neu-flat rounded-3xl p-6 md:p-8 w-full max-w-md flex flex-col items-center">
          <div className="neu-convex w-24 h-24 rounded-full flex items-center justify-center mb-8 text-neu-accent">
            <MessageSquare size={40} />
          </div>
          <h1 className="text-2xl font-bold mb-2 text-neu-text">Neumorphic Chat</h1>
          <p className="text-sm opacity-70 mb-8 text-center">Sign in to access your secure chat history.</p>
          
          {authErrorDomain ? (
            <div className="w-full mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 flex flex-col items-center text-center">
              <p className="font-bold mb-2">Domain Not Authorized</p>
              <p className="text-xs mb-4 opacity-80">
                Firebase is blocking this preview URL. Go to Firebase Console &gt; Authentication &gt; Settings &gt; Authorized Domains and add this exact text:
              </p>
              <div className="w-full bg-black/10 p-3 rounded-xl flex items-center justify-between gap-2">
                <code className="text-xs select-all break-all">{authErrorDomain}</code>
                <button 
                  onClick={() => navigator.clipboard.writeText(authErrorDomain)}
                  className="shrink-0 px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-bold hover:bg-red-600 transition-colors"
                >
                  Copy
                </button>
              </div>
              <button 
                onClick={() => setAuthErrorDomain(null)}
                className="mt-4 text-xs underline opacity-70 hover:opacity-100"
              >
                Try Again
              </button>
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              className="w-full neu-flat hover:neu-convex active:neu-pressed rounded-2xl py-4 font-semibold text-neu-accent transition-all flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </button>
          )}

          <div className="w-full flex items-center gap-4 my-6 opacity-50">
            <div className="flex-1 h-px bg-neu-text"></div>
            <span className="text-xs font-medium uppercase">or</span>
            <div className="flex-1 h-px bg-neu-text"></div>
          </div>

          <form onSubmit={handleGuestJoin} className="w-full flex flex-col gap-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-neu-text opacity-50">
                <UserIcon size={20} />
              </div>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                dir="auto"
                placeholder="Enter guest name"
                className="w-full neu-pressed rounded-2xl py-4 pl-12 pr-4 outline-none text-neu-text placeholder:text-neu-text/50 focus:ring-2 focus:ring-neu-accent/30 transition-all"
                maxLength={20}
              />
            </div>
            <button
              type="submit"
              disabled={!guestName.trim()}
              className="w-full neu-flat hover:neu-convex active:neu-pressed rounded-2xl py-4 font-semibold text-neu-text transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join as Guest
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-2 md:p-4 lg:p-8">
      <div className="w-full max-w-6xl h-[calc(100dvh-1rem)] md:h-[85vh] flex gap-4 md:gap-6">
        
        {/* Sidebar - Contacts List */}
        <div className={cn(
          "flex-col w-full md:w-80 neu-flat rounded-3xl p-4 md:p-6 shrink-0 h-full",
          selectedUser ? "hidden md:flex" : "flex"
        )}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users size={24} className="text-neu-accent" />
              Contacts
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
            {users.length === 0 ? (
              <div className="text-center opacity-50 text-sm mt-10">
                No other users found.
              </div>
            ) : (
              users.map((user) => {
                const unread = selectedUser?.id === user.id ? 0 : (unreadCounts[user.id] || 0);
                const isSelected = selectedUser?.id === user.id;
                
                return (
                  <div 
                    key={user.id} 
                    onClick={() => selectUser(user)}
                    className={cn(
                      "rounded-2xl p-4 flex items-center gap-3 cursor-pointer transition-all",
                      isSelected ? "neu-pressed" : "neu-flat hover:neu-convex"
                    )}
                  >
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.name} className="w-10 h-10 rounded-full neu-convex object-cover shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-10 h-10 rounded-full neu-convex flex items-center justify-center text-neu-accent font-bold shrink-0">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      <p className="font-medium truncate">{user.name}</p>
                      {user.isOnline ? (
                        <p className="text-xs opacity-60 text-green-500">Online</p>
                      ) : (
                        <p className="text-xs opacity-40">Offline</p>
                      )}
                    </div>
                    {unread > 0 && (
                      <div className="w-6 h-6 rounded-full bg-neu-accent text-white text-xs flex items-center justify-center font-bold shadow-md shrink-0">
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          
          <div className="mt-6 pt-6 border-t border-neu-text/10 flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              {currentUser?.photoURL ? (
                <img src={currentUser.photoURL} alt={currentUser.name} className="w-8 h-8 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-neu-accent/10 flex items-center justify-center text-neu-accent font-bold shrink-0">
                  {currentUser?.name?.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium truncate opacity-70">{currentUser?.name}</span>
            </div>
            <button
              onClick={handleLogout}
              className="w-10 h-10 neu-flat hover:neu-convex active:neu-pressed rounded-full flex items-center justify-center text-red-500 transition-all shrink-0"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className={cn(
          "flex-1 flex-col neu-flat rounded-3xl overflow-hidden h-full",
          !selectedUser ? "hidden md:flex" : "flex"
        )}>
          {!selectedUser ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-50 p-8 text-center">
              <MessageSquare size={64} className="mb-6 text-neu-accent opacity-50" />
              <h2 className="text-2xl font-bold mb-2">Welcome, {currentUser?.name}!</h2>
              <p>Select a contact from the sidebar to start a private conversation.</p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="p-3 md:p-6 border-b border-neu-text/10 flex items-center gap-3 md:gap-4 shrink-0">
                <button 
                  onClick={() => setSelectedUser(null)}
                  className="md:hidden w-10 h-10 neu-flat hover:neu-convex active:neu-pressed rounded-full flex items-center justify-center text-neu-accent shrink-0"
                >
                  <ChevronLeft size={20} />
                </button>
                {selectedUser.photoURL ? (
                  <img src={selectedUser.photoURL} alt={selectedUser.name} className="w-10 h-10 md:w-12 md:h-12 rounded-full neu-convex object-cover shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-full neu-convex flex items-center justify-center text-neu-accent font-bold text-base md:text-lg shrink-0">
                    {selectedUser.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  <h3 className="font-bold text-base md:text-lg truncate">{selectedUser.name}</h3>
                  {selectedUser.isOnline ? (
                    <p className="text-xs text-green-500 font-medium">Online</p>
                  ) : (
                    <p className="text-xs opacity-50 font-medium">Offline</p>
                  )}
                </div>
              </div>

              {/* Messages Area */}
              <div className="flex-1 p-4 md:p-6 overflow-y-auto custom-scrollbar flex flex-col gap-4 md:gap-6">
                {messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                    <p>No messages yet. Say hi to {selectedUser.name}!</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {messages.map((msg) => {
                      const isMe = msg.senderId === currentUser?.id;
                      return (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.2 }}
                          className={cn(
                            "flex flex-col max-w-[80%]",
                            isMe ? "self-end items-end" : "self-start items-start"
                          )}
                        >
                          <span className="text-[10px] md:text-xs opacity-60 mb-1 px-2 flex items-center gap-1 font-medium">
                            {format(new Date(msg.timestamp), 'h:mm a')}
                            {isMe && <MessageStatusIndicator status={msg.status || 'sent'} />}
                          </span>
                          <div
                            className={cn(
                              "px-4 py-2 md:px-5 md:py-3 rounded-2xl text-sm md:text-base transition-all duration-300",
                              isMe 
                                ? "neu-bubble-sent text-neu-text rounded-br-sm" 
                                : "neu-bubble-received text-neu-text rounded-bl-sm"
                            )}
                          >
                            <p className="break-words leading-relaxed" dir="auto">{msg.text}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
                
                {/* Typing Indicator */}
                {isSelectedUserTyping && (
                  <div className="self-start flex items-center gap-2 text-xs opacity-60 px-2 mt-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-neu-text rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-neu-text rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-neu-text rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span>{selectedUser.name} is typing...</span>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-3 md:p-6 pt-2 shrink-0">
                <ChatInput 
                  currentUser={currentUser!}
                  selectedUser={selectedUser} 
                  onSendMessage={handleSendMessage} 
                />
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(74, 85, 104, 0.2);
          border-radius: 20px;
        }
      `}</style>
    </div>
  );
}
