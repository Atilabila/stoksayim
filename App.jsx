import React, { useState } from 'react';
import CountingScreen from './CountingScreen';
import AdminDashboard from './AdminDashboard';
import { Toaster } from 'react-hot-toast';
import { supabase } from './supabaseClient';

export default function App() {
    const [view, setView] = useState('login'); // 'login', 'counting', 'admin'
    const [branchId, setBranchId] = useState(null);
    const [branchInfo, setBranchInfo] = useState(null);
    const [personName, setPersonName] = useState('');
    const [askPersonName, setAskPersonName] = useState(false);
    const [personNameDraft, setPersonNameDraft] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const getPersonStorageKey = (bId) => `stoksayim_person_name_${bId || 'unknown'}`;

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        // Check if it's the master admin
        if (username === 'admin' && password === 'supersecret') {
            setView('admin');
            setIsLoading(false);
            return;
        }

        // Branch Login via Supabase
        const { data: branch, error } = await supabase
            .from('branches')
            .select('id, branch_name, vkn, password_hash')
            .eq('username', username)
            .single();

        if (error || !branch) {
            alert("Hatalı kullanıcı adı. Lütfen tekrar deneyin.");
            setIsLoading(false);
            return;
        }

        if (branch.password_hash === password) {
            setBranchId(branch.id);
            setBranchInfo({
                id: branch.id,
                branchName: branch.branch_name || username,
                vkn: branch.vkn || null,
            });
            const savedName = (typeof window !== 'undefined' && branch?.id)
                ? (localStorage.getItem(getPersonStorageKey(branch.id)) || '')
                : '';
            setPersonName(savedName);
            setPersonNameDraft(savedName);
            setAskPersonName(true);
            setView('counting');
        } else {
            alert("Hatalı şifre. Lütfen tekrar deneyin.");
        }

        setIsLoading(false);
    };

    return (
        <div className="font-sans h-screen w-screen overflow-hidden bg-izbel-dark flex flex-col text-white">
            <Toaster position="top-center"
                toastOptions={{
                    style: {
                        background: '#151828',
                        color: '#fff',
                        border: '1px solid #334155',
                        fontFamily: 'Outfit, sans-serif',
                        fontWeight: 'bold',
                        padding: '16px',
                    },
                }}
            />

            {view === 'login' && (
                <div className="flex-1 flex flex-col justify-center items-center p-6 relative">

                    {/* Abstract Background Elements */}
                    <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600 rounded-full mix-blend-screen filter blur-[100px] opacity-20"></div>
                        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600 rounded-full mix-blend-screen filter blur-[100px] opacity-20"></div>
                    </div>

                    <div className="bg-izbel-card/80 backdrop-blur-xl p-10 md:p-14 rounded-[2rem] shadow-2xl w-full max-w-md border border-white/5 flex flex-col items-center relative z-10">

                        {/* Premium Branding Logo / Tag */}
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <div className="w-4 h-4 rounded-full bg-blue-500 shadow-glow animate-pulse"></div>
                            <div className="w-1 h-4 bg-gray-600 rounded-full hidden"></div>
                            <span className="text-gray-400 font-bold uppercase text-xs tracking-[0.3em] ml-2">İzbel Kurumsal</span>
                        </div>

                        <h1 className="text-4xl md:text-5xl font-black text-white mb-10 text-center leading-none tracking-tight">STOK SAYIM</h1>

                        <form onSubmit={handleLogin} className="w-full space-y-6">
                            <div>
                                <label className="text-xs uppercase font-bold text-gray-500 tracking-widest pl-2 mb-1 block">Kullanıcı Adı</label>
                                <input
                                    type="text"
                                    placeholder="Şube veya admin"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-izbel-dark/50 border border-white/10 p-4 rounded-2xl text-xl font-medium focus:border-blue-500 focus:bg-izbel-dark focus:ring-4 focus:ring-blue-500/20 outline-none transition-all text-white placeholder-gray-700"
                                />
                            </div>
                            <div>
                                <label className="text-xs uppercase font-bold text-gray-500 tracking-widest pl-2 mb-1 block">Şifre</label>
                                <input
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-izbel-dark/50 border border-white/10 p-4 rounded-2xl text-xl font-medium focus:border-blue-500 focus:bg-izbel-dark focus:ring-4 focus:ring-blue-500/20 outline-none transition-all text-white placeholder-gray-700"
                                />
                            </div>
                            <button
                                disabled={isLoading}
                                type="submit"
                                className="w-full relative overflow-hidden group bg-blue-600 text-white font-black py-4 rounded-2xl shadow-[0_0_20px_rgba(37,99,235,0.3)] border border-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] hover:border-blue-400 active:scale-95 transition-all text-xl mt-6 tracking-wide"
                            >
                                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-blue-700 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                <span className="relative z-10">{isLoading ? 'YETKİ KONTROLÜ...' : 'SİSTEME GİRİŞ YAP'}</span>
                            </button>
                        </form>
                    </div>

                    <div className="relative z-10 mt-8 text-center text-gray-600 text-sm font-medium tracking-wide">
                        PRO-STOCK INVENTORY &copy; 2026
                    </div>
                </div>
            )}

            {view === 'counting' && (
                <div className="flex-1 overflow-y-auto bg-gray-50">
                    <CountingScreen
                        branchId={branchId}
                        branchInfo={branchInfo}
                        personName={personName}
                        onLogout={() => {
                            setView('login');
                            setBranchId(null);
                            setBranchInfo(null);
                            setPersonName('');
                            setAskPersonName(false);
                            setPersonNameDraft('');
                        }}
                    />
                </div>
            )}

            {view === 'admin' && (
                <div className="flex-1 overflow-y-auto">
                    <AdminDashboard onLogout={() => setView('login')} />
                </div>
            )}

            {/* Personel adı sor (şube login sonrası) */}
            {view === 'counting' && askPersonName && (
                <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-izbel-card/95 border border-white/10 rounded-[2rem] w-full max-w-md p-6 shadow-2xl">
                        <h2 className="text-xl font-black tracking-tight">Sayımı kim başlattı?</h2>
                        <p className="text-sm text-gray-400 font-bold mt-1">Bu isim sayım ekranında görünecek.</p>

                        <div className="mt-5">
                            <label className="text-xs uppercase font-bold text-gray-500 tracking-widest pl-2 mb-2 block">Personel adı</label>
                            <input
                                type="text"
                                value={personNameDraft}
                                onChange={(e) => setPersonNameDraft(e.target.value)}
                                placeholder="Örn: Ahmet Yılmaz"
                                className="w-full bg-izbel-dark/50 border border-white/10 p-4 rounded-2xl text-lg font-medium focus:border-blue-500 focus:bg-izbel-dark focus:ring-4 focus:ring-blue-500/20 outline-none transition-all text-white placeholder-gray-700"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const name = (personNameDraft || '').trim();
                                        if (!name) return;
                                        setPersonName(name);
                                        if (typeof window !== 'undefined' && branchId) {
                                            localStorage.setItem(getPersonStorageKey(branchId), name);
                                        }
                                        setAskPersonName(false);
                                    }
                                }}
                            />
                        </div>

                        <div className="mt-6 flex gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    // İsim zorunlu: boşsa kapatma
                                    const name = (personNameDraft || '').trim();
                                    if (!name) return;
                                    setPersonName(name);
                                    if (typeof window !== 'undefined' && branchId) {
                                        localStorage.setItem(getPersonStorageKey(branchId), name);
                                    }
                                    setAskPersonName(false);
                                }}
                                className="flex-1 bg-blue-600 hover:bg-blue-500 transition-colors text-white font-black py-4 rounded-2xl tracking-widest"
                            >
                                DEVAM ET
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
