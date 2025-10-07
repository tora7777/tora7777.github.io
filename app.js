'use strict';

// ★★★ LocalStorageの依存を排除し、Firestoreのグローバル関数を使用します ★★★

/**
 * アプリケーション設定モジュール
 * システム全体の設定値を管理
 */
const AppConfig = {
    collegeMap: {
        'c': { name: 'ITカレッジ' },
        'a': { name: 'クリエイターズカレッジ' },
        'b': { name: 'ミュージックカレッジ' },
        'd': { name: 'テクノロジーカレッジ' },
        'g': { name: 'デザインカレッジ' }
    },
    booths: [
        { id: 1, name: 'ブース1', college: 'd', collegeName: 'テクノロジーカレッジ' },
        { id: 2, name: 'ブース2', college: 'c', collegeName: 'ITカレッジ' },
        { id: 3, name: 'ブース3', college: 'a', collegeName: 'クリエイターズカレッジ' },
        { id: 4, name: 'ブース4', college: 'g', collegeName: 'デザインカレッジ' },
        { id: 5, name: 'ブース5', college: 'b', collegeName: 'ミュージックカレッジ' },
        { id: 6, name: 'ブース6', college: 'common', collegeName: '共通利用' },
        { id: 7, name: 'ブース7', college: 'common', collegeName: '共通利用' }
    ],
    businessHours: {
        start: 9,
        end: 17,
        slotDuration: 10
    },
    adminUsers: [
        'admin@g.neec.ac.jp', // Example admin
    ],
    emailConfig: {
        domain: '@g.neec.ac.jp',
        pattern: /^k[0-9]{3}[a-z][0-9]{4}@g\.neec\.ac\.jp$/
    }
};

/**
 * メール送信サービス
 * EmailJSと連携してメールを送信する
 */
class EmailService {
    constructor() {
        this.SERVICE_ID = 'service_f0gi9iu';
        this.VERIFICATION_TEMPLATE_ID = 'template_8ybqr9d'; 
        this.RESERVATION_NOTIFICATION_ID = 'template_yfflz44'; 
        this.PUBLIC_KEY = '9TmVa1GEItX3KSTKT'; 

        if (typeof emailjs !== 'undefined') {
            emailjs.init(this.PUBLIC_KEY);
        } else {
            console.error("EmailJS SDK not loaded. Please check the script tag in your HTML.");
        }
    }

   async send(templateId, templateParams) {
        try {
            const response = await emailjs.send(this.SERVICE_ID, templateId, templateParams);
            console.log('Email sent successfully!', response.status, response.text);
            return response;
        } catch (error) {
            console.error('Failed to send email:', error);
            throw error;
        }
    }

    /**
     * ユーザー認証メールを送信 (トークン保存先: Firestore)
     */
    async sendVerificationEmail(toEmail) {
        const verificationToken = this.generateVerificationToken();
        const verificationLink = `${window.location.origin}${window.location.pathname}?token=${verificationToken}&email=${encodeURIComponent(toEmail)}`;
        
        // ★Firestoreにトークンを保存 (Doc IDはメールアドレス)
        // コレクション: verificationTokens
        const tokenDocRef = doc(window.db, "verificationTokens", toEmail);
        await setDoc(tokenDocRef, {
            token: verificationToken,
            expiry: Date.now() + 24 * 60 * 60 * 1000 
        });
        
        const params = {
            to_email: toEmail,
            verification_link: verificationLink
        };
        return this.send(this.VERIFICATION_TEMPLATE_ID, params);
    }

    /**
     * 予約完了またはキャンセルメールを送信する統合メソッド
     */
    sendReservationNotification(reservation, type) {
        let actionType;
        let actionTypeStatus;
        
        if (type === 'CONFIRM') {
            actionType = '予約完了';
            actionTypeStatus = '完了';
        } else if (type === 'CANCEL') {
            actionType = '予約キャンセル';
            actionTypeStatus = 'キャンセル';
        } else {
            console.error('Invalid notification type:', type);
            return Promise.reject(new Error('Invalid notification type'));
        }

        const params = {
            to_email: reservation.email,
            student_id: reservation.studentId,
            action_type: actionType, 
            action_type_status: actionTypeStatus,
            reservation_details: `
                日付: ${reservation.date}
                時間: ${reservation.startTime} から ${reservation.duration}分
                ブース: ${reservation.boothName} (${reservation.assignedCollegeName})
                予約ID: ${reservation.id}
            `
        };

        return this.send(this.RESERVATION_NOTIFICATION_ID, params);
    }

    generateVerificationToken() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    }

    /**
     * 認証トークンを検証 (Firestoreから読み込み/削除)
     */
    async verifyToken(email, token) {
        const tokenDocRef = doc(window.db, "verificationTokens", email);
        const tokenDoc = await getDoc(tokenDocRef); 

        if (!tokenDoc.exists()) {
            return false;
        }
        
        const storedData = tokenDoc.data();
        
        if (storedData.token !== token) return false;
        if (Date.now() > storedData.expiry) return false;
        
        // 認証成功したらトークンを削除
        await deleteDoc(tokenDocRef);
        
        return true;
    }
}


/**
 * 認証コントローラー
 */
class AuthenticationController {
    constructor(emailService) { 
        this.emailService = emailService;
        this.currentUser = null;
    }

    // ★修正: FirestoreのDBオブジェクトがロードされるのを待ってから処理を開始
    async initialize() {
        // DBオブジェクトが初期化されるのを待つ (window.dbが存在するかチェック)
        while (typeof window.db === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // セッション情報はLocalStorageから取得
        const savedUser = localStorage.getItem('currentUser');
        if (savedUser) {
            this.currentUser = JSON.parse(savedUser);
            // ログイン状態であればUIを更新
            this.showLoggedInState();
        }
    }

    /**
     * Firestoreからユーザーをメールアドレスで検索 (コレクション: users)
     */
    async getUserByEmail(email) {
        // window.dbが確実に存在することを期待
        const userDocRef = doc(window.db, "users", email); 
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            return null;
        }
        
        const userData = userDoc.data();
        userData.docId = userDoc.id; // ドキュメントID (この場合はメールアドレス)
        return userData;
    }

    // ======= handleLogin (非同期化, Firestore対応) =======
    async handleLogin(event) {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            // DBロード待機はinitializeで実施済みだが、念のためDBの存在を確認
            if (typeof window.db === 'undefined') {
                NotificationService.show('データベース接続が未完了です。時間をおいて再試行してください。', 'error');
                return;
            }
            
            const user = await this.getUserByEmail(email); 

            if (!user) {
                NotificationService.show('メールアドレスまたはパスワードが正しくありません', 'error');
                return;
            }

            if (user.password !== this.hashPassword(password)) {
                NotificationService.show('メールアドレスまたはパスワードが正しくありません', 'error');
                return;
            }

            if (!user.verified) {
                NotificationService.show('メールアドレスが認証されていません。', 'error');
                if (confirm('認証メールを再送信しますか？')) {
                    await this.resendVerificationEmail(email);
                }
                return;
            }

            // ログイン成功処理
            const studentId = email.split('@')[0];
            const collegeChar = studentId.charAt(4);
            const userCollege = AppConfig.collegeMap[collegeChar];
            const isAdmin = AppConfig.adminUsers.includes(email);

            this.currentUser = {
                email: email,
                studentId: studentId,
                college: collegeChar,
                collegeName: userCollege ? userCollege.name : '不明',
                isAdmin: isAdmin,
                docId: user.docId
            };

            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            this.showLoggedInState();
            NotificationService.show('ログインしました', 'success');
        } catch (error) {
            // Firestoreのエラー(権限、接続など)はここでキャッチされる
            console.error("Login Error:", error);
            NotificationService.show('ログイン処理中にエラーが発生しました。データベース接続を確認してください。', 'error');
        }
    }

    // ======= handleRegister (非同期化, Firestore対応) =======
    async handleRegister(event) {
        event.preventDefault();
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;
        const passwordConfirm = document.getElementById('regPasswordConfirm').value;

        if (!AppConfig.emailConfig.pattern.test(email)) {
            NotificationService.show('学校指定のメールアドレス形式ではありません', 'error');
            return;
        }
        if (password.length < 8) {
            NotificationService.show('パスワードは8文字以上で設定してください', 'error');
            return;
        }
        if (password !== passwordConfirm) {
            NotificationService.show('パスワードが一致しません', 'error');
            return;
        }

        const existingUser = await this.getUserByEmail(email); 
        if (existingUser) {
            NotificationService.show('このメールアドレスは既に使用されています', 'error');
            return;
        }

        const newUser = {
            email: email,
            password: this.hashPassword(password),
            verified: false,
            createdAt: new Date().toISOString()
        };
        
        const usersCol = collection(window.db, "users");
        
        try {
            await setDoc(doc(usersCol, email), newUser); 

            await this.emailService.sendVerificationEmail(email);
            
            document.getElementById('registerForm').classList.add('hidden');
            document.getElementById('verificationMessage').classList.remove('hidden');
            document.getElementById('verificationMessage').innerHTML = `
                <div class="alert alert-success">
                    <h3>認証メールを送信しました！</h3>
                    <p>${email} 宛てに認証メールを送信しました。</p>
                    <p>メール内のリンクをクリックして認証を完了してください。</p>
                    <p><small>メールが届かない場合は、迷惑メールフォルダをご確認ください。</small></p>
                </div>
                <button class="btn btn-secondary" onclick="AuthController.showLoginForm()">
                    ログイン画面に戻る
                </button>
            `;
        } catch (error) {
            console.error("Registration Error:", error);
            NotificationService.show('登録処理中にエラーが発生しました。データベース接続を確認してください。', 'error');
            await deleteDoc(doc(usersCol, email)).catch(e => console.error("Cleanup failed:", e));
        }
    }

    // ======= checkVerificationFromURL (非同期化) =======
    async checkVerificationFromURL() {
        // DBロード待機
        while (typeof window.db === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const email = urlParams.get('email');
        
        if (token && email) {
            await this.verifyUserWithToken(email, token);
        }
    }

    // ======= verifyUserWithToken (非同期化, Firestore対応) =======
    async verifyUserWithToken(email, token) {
        try {
            const isVerified = await this.emailService.verifyToken(email, token);

            if (isVerified) {
                const user = await this.getUserByEmail(email); 
                if (user) {
                    const userDocRef = doc(window.db, "users", user.docId);
                    await updateDoc(userDocRef, { verified: true });
                    
                    NotificationService.show('メールアドレスの認証が完了しました！ログインしてください。', 'success');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    this.showLoginForm();
                } else {
                    NotificationService.show('ユーザーが見つかりません。新規登録してください。', 'error');
                }
            } else {
                NotificationService.show('認証リンクが無効または期限切れです。', 'error');
            }
        } catch (error) {
             console.error("Verification Error:", error);
             NotificationService.show('認証中にエラーが発生しました。', 'error');
        }
    }

    /**
     * パスワードのハッシュ化（簡易版）
     */
    hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    async resendVerificationEmail(email) {
        try {
            await this.emailService.sendVerificationEmail(email);
            NotificationService.show('認証メールを再送信しました。', 'success');
        } catch (error) {
            NotificationService.show('メールの再送信に失敗しました。', 'error');
        }
    }

    // ======= verifyUser（デモ用、Firestore対応）=======
    async verifyUser(email) {
        try {
            // DBロード待機
            while (typeof window.db === 'undefined') {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            const user = await this.getUserByEmail(email);
            if (user) {
                const userDocRef = doc(window.db, "users", user.docId);
                await updateDoc(userDocRef, { verified: true });
                
                NotificationService.show('メールアドレスが認証されました。ログインしてください。', 'success');
                document.getElementById('verificationMessage').classList.add('hidden');
                this.showLoginForm();
            } else {
                NotificationService.show('デモ認証失敗: ユーザーが見つかりません。', 'error');
            }
        } catch (error) {
            console.error("Demo Verification Error:", error);
            NotificationService.show('デモ認証中にエラーが発生しました。', 'error');
        }
    }

    showLoggedInState() {
        document.getElementById('header').classList.remove('hidden');
        document.getElementById('userEmail').textContent = this.currentUser.studentId;
        
        document.getElementById('adminLink').classList.toggle('hidden', !this.currentUser.isAdmin);
        
        NavigationController.navigateTo('reservation');
    }

    logout() {
        if (confirm('ログアウトしますか？')) {
            localStorage.removeItem('currentUser'); 
            this.currentUser = null;
            document.getElementById('header').classList.add('hidden');
            document.getElementById('email').value = '';
            document.getElementById('password').value = '';
            NavigationController.navigateTo('login');
            NotificationService.show('ログアウトしました', 'success');
        }
    }

    showRegisterForm() {
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('verificationMessage').classList.add('hidden');
        document.getElementById('registerForm').classList.remove('hidden');
    }

    showLoginForm() {
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('verificationMessage').classList.add('hidden');
        document.getElementById('registerForm').classList.add('hidden');
    }

    getCurrentUser() {
        return this.currentUser;
    }
    
}


/**
 * 予約管理コントローラー
 */
class ReservationManagementController {
    constructor(emailService) { 
        this.emailService = emailService;
        this.reservations = [];
    }

    // ★★★ Firestoreから予約データを読み込む ★★★
    async loadReservations() {
        try {
            // DBロード待機
            while (typeof window.db === 'undefined') {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            const reservationsCol = collection(window.db, "reservations");
            const reservationSnapshot = await getDocs(reservationsCol);
            
            this.reservations = reservationSnapshot.docs.map(doc => {
                const data = doc.data();
                data.docId = doc.id; 
                data.id = data.id || doc.id;
                return data;
            });
        } catch (error) {
            console.error("Failed to load reservations:", error);
            NotificationService.show('予約データのロードに失敗しました。データベース接続を確認してください。', 'error');
            this.reservations = [];
        }
    }

    async initialize() {
        await this.loadReservations(); // ★予約データを非同期でロード
        
        const dateInput = document.getElementById('reservationDate');
        if (dateInput && dateInput.value) {
            this.updateAvailability();
        } else {
            const timeSlotsContainer = document.getElementById('timeSlots');
            if (timeSlotsContainer) {
                timeSlotsContainer.innerHTML = '<div class="time-slot-placeholder">日付を選択してください</div>';
            }
        }
        this.setDateConstraints();
    }
    
    // ... (他のメソッドは Firestore対応のまま変更なし) ...

    setDateConstraints() {
        const dateInput = document.getElementById('reservationDate');
        if (dateInput) {
            const today = new Date();
            const maxDate = new Date();
            maxDate.setMonth(maxDate.getMonth() + 3);
            
            dateInput.min = today.toISOString().split('T')[0];
            dateInput.max = maxDate.toISOString().split('T')[0];
        }
    }

    renderTimeSlots() {
        const container = document.getElementById('timeSlots');
        if (!container) return;

        const slots = [];
        const { start, end, slotDuration } = AppConfig.businessHours;
        
        for (let hour = start; hour < end; hour++) {
            for (let min = 0; min < 60; min += slotDuration) {
                const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
                slots.push(time);
            }
        }

        container.innerHTML = slots.map(time => `
            <div class="time-slot" 
                 onclick="ReservationController.selectTime('${time}')"
                 data-time="${time}">
                ${time}
            </div>
        `).join('');
    }

    selectTime(time) {
        document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('selected'));
        const selectedSlot = document.querySelector(`[data-time="${time}"]`);
        if (selectedSlot && !selectedSlot.classList.contains('unavailable')) {
            selectedSlot.classList.add('selected');
            this.selectedTime = time;
        }
    }

    updateAvailability() {
        const date = document.getElementById('reservationDate').value;
        const timeSlotsContainer = document.getElementById('timeSlots');

        if (!date) {
            timeSlotsContainer.innerHTML = '<div class="time-slot-placeholder">日付を選択してください</div>';
            return;
        }

        if (!timeSlotsContainer.querySelector('.time-slot')) {
             this.renderTimeSlots();
        }

        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.classList.remove('unavailable', 'selected');
        });
        this.selectedTime = null;

        const allBookedSlotsForDate = this.reservations
            .filter(r => r.date === date)
            .flatMap(r => {
                const booked = [];
                const [startHour, startMin] = r.startTime.split(':').map(Number);
                const startMinutes = startHour * 60 + startMin;
                
                for (let i = 0; i < r.duration; i += AppConfig.businessHours.slotDuration) {
                    const slotMinutes = startMinutes + i;
                    const hour = Math.floor(slotMinutes / 60);
                    const min = slotMinutes % 60;
                    booked.push({
                        time: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
                        boothId: r.boothId
                    });
                }
                return booked;
            });
        
        const bookedBoothsByTime = allBookedSlotsForDate.reduce((acc, slot) => {
            if (!acc[slot.time]) acc[slot.time] = new Set();
            acc[slot.time].add(slot.boothId);
            return acc;
        }, {});

        Object.entries(bookedBoothsByTime).forEach(([time, bookedBooths]) => {
             if (bookedBooths.size >= AppConfig.booths.length) {
                const slotEl = document.querySelector(`[data-time="${time}"]`);
                if (slotEl) {
                    slotEl.classList.add('unavailable');
                }
             }
        });
    }

    assignBooth(date, startTime, duration) {
        const currentUser = AuthController.getCurrentUser();
        if (!currentUser) return null;
        
        const [startHour, startMin] = startTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = startMinutes + duration;

        const checkAvailability = (booth) => {
            return !this.reservations.some(reservation => {
                if (reservation.date !== date || reservation.boothId !== booth.id) return false;
                const [resStartHour, resStartMin] = reservation.startTime.split(':').map(Number);
                const resStartMinutes = resStartHour * 60 + resStartMin;
                const resEndMinutes = resStartMinutes + reservation.duration;
                return (startMinutes < resEndMinutes && endMinutes > resStartMinutes);
            });
        };
        
        const availableBooths = AppConfig.booths.filter(checkAvailability);
        
        const boothReservationCounts = availableBooths.reduce((acc, booth) => {
            acc[booth.id] = this.reservations.filter(r => r.boothId === booth.id).length;
            return acc;
        }, {});
        
        availableBooths.sort((a, b) => boothReservationCounts[a.id] - boothReservationCounts[b.id]);

        const ownCollegeBooth = availableBooths.find(b => b.college === currentUser.college);
        if (ownCollegeBooth) return ownCollegeBooth;

        const commonBooth = availableBooths.find(b => b.college === 'common');
        if (commonBooth) return commonBooth;
        
        return availableBooths[0] || null;
    }

    handleReservation(event) {
        event.preventDefault();
        if (!this.selectedTime) {
            NotificationService.show('時間を選択してください', 'error');
            return;
        }

        const date = document.getElementById('reservationDate').value;
        const duration = parseInt(document.getElementById('duration').value);
        const purpose = document.getElementById('purpose').value;
        const reminder = document.getElementById('reminder').checked;
        const currentUser = AuthController.getCurrentUser();
        
        const assignedBooth = this.assignBooth(date, this.selectedTime, duration);
        
        if (!assignedBooth) {
            NotificationService.show('選択した時間帯に利用可能なブースがありません', 'error');
            return;
        }

        const isOtherCollege = assignedBooth.college !== currentUser.college && assignedBooth.college !== 'common';

        this.pendingReservation = {
            id: `RES-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // 仮のID
            studentId: currentUser.studentId,
            email: currentUser.email,
            boothId: assignedBooth.id,
            boothName: assignedBooth.name,
            collegeName: currentUser.collegeName, // 予約者の所属カレッジを記録
            assignedCollegeName: assignedBooth.collegeName, // 割り当てられたブースのカレッジ
            date: date,
            startTime: this.selectedTime,
            duration: duration,
            purpose: purpose,
            reminder: reminder,
            isOtherCollege: isOtherCollege,
            createdAt: new Date().toISOString(),
            status: 'confirmed'
        };

        ModalController.showConfirmModal(this.pendingReservation);
    }

    // ======= confirmReservation (Firestoreに保存) =======
    async confirmReservation() {
        if (!this.pendingReservation) return;
        
        const reservationsCol = collection(window.db, "reservations");
        const newDocRef = doc(reservationsCol); 
        
        const reservationData = { 
            ...this.pendingReservation,
            id: newDocRef.id // Firestore IDを予約IDとして使用
        };
        
        try {
            await setDoc(newDocRef, reservationData); // ★DB書き込み
        } catch (e) {
            console.error("Firestore Save Error:", e);
            NotificationService.show('予約の保存に失敗しました。', 'error');
            return;
        }

        try {
            await this.emailService.sendReservationNotification(reservationData, 'CONFIRM');
        } catch(error) {
            NotificationService.show('メール送信に失敗しました。予約は完了しています。', 'error');
        }

        if (reservationData.isOtherCollege) {
            console.log(`Slack通知送信: ${reservationData.email}が${reservationData.assignedCollegeName}のブースを予約しました。`);
        }

        ModalController.closeModal('confirmModal');
        NotificationService.show('予約が完了しました', 'success');
        this.resetReservationForm();
        await this.initialize(); 
    }

    resetReservationForm() {
        document.getElementById('reservationDate').value = '';
        document.getElementById('duration').value = '60';
        document.getElementById('purpose').value = '';
        document.getElementById('reminder').checked = false;
        this.selectedTime = null;
        this.pendingReservation = null;
    }

    // ======= loadUserReservations (Firestoreから読み込み) =======
    async loadUserReservations() {
        const container = document.getElementById('userReservations');
        const currentUser = AuthController.getCurrentUser();
        if (!container || !currentUser) return;
        
        await this.loadReservations(); 
        
        const userReservations = this.reservations
            .filter(r => r.email === currentUser.email)
            .sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));
        
        if (userReservations.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">予約はありません</p>';
            return;
        }
        
        container.innerHTML = userReservations.map(res => {
            const isPast = new Date(`${res.date}T${res.startTime}`) < new Date();
            return `
                <div class="reservation-item" style="border: 1px solid var(--border-color); border-radius: var(--border-radius); padding: 1rem; margin-bottom: 1rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; ${isPast ? 'opacity: 0.6;' : ''}">
                    <div>
                        <h4 style="margin-bottom: 0.5rem; font-size: 1.1rem;">${res.date} ${res.startTime} ${isPast ? ' (終了)' : ''}</h4>
                        <p style="font-size: 0.9rem; color: var(--text-secondary);">ブース: ${res.boothName} | 時間: ${res.duration}分</p>
                    </div>
                    <div>
                        ${!isPast ? `<button class="btn" onclick="ReservationController.cancelReservation('${res.id}')" style="background: var(--danger-color); color: white;">キャンセル</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ======= cancelReservation (Firestoreから削除) =======
    async cancelReservation(reservationId) {
        if (!confirm('本当にこの予約をキャンセルしますか？')) return;
        
        await this.loadReservations(); 
        const canceled = this.reservations.find(r => r.id === reservationId);
        if (!canceled) return;
        
        const reservationDocRef = doc(window.db, "reservations", canceled.docId);
        try {
            await deleteDoc(reservationDocRef);
        } catch (e) {
            console.error("Firestore Delete Error:", e);
            NotificationService.show('予約のキャンセルに失敗しました。', 'error');
            return;
        }

        try {
            await this.emailService.sendReservationNotification(canceled, 'CANCEL');
        } catch(error) {
            NotificationService.show('キャンセルメールの送信に失敗しました。', 'error');
        }

        NotificationService.show('予約をキャンセルしました', 'success');
        await this.loadUserReservations(); 
    }
}

/**
 * 管理者コントローラー
 */
class AdminController {
    constructor(emailService) { 
        this.emailService = emailService;
        this.reservations = []; 
        this.users = []; 
    }
    
    async getAllReservations() {
        // DBロード待機
        while (typeof window.db === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        try {
            const reservationsCol = collection(window.db, "reservations");
            const reservationSnapshot = await getDocs(reservationsCol);
            
            return reservationSnapshot.docs.map(doc => {
                const data = doc.data();
                data.docId = doc.id; 
                data.id = data.id || doc.id;
                return data;
            });
        } catch (e) {
            console.error("Admin Load Reservations Error:", e);
            return [];
        }
    }
    
    async getAllUsers() {
        // DBロード待機
        while (typeof window.db === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        try {
            const usersCol = collection(window.db, "users");
            const userSnapshot = await getDocs(usersCol);
            
            return userSnapshot.docs.map(doc => doc.data());
        } catch (e) {
            console.error("Admin Load Users Error:", e);
            return [];
        }
    }

    async loadAdminData() {
        this.reservations = await this.getAllReservations(); 
        this.users = await this.getAllUsers();
        
        this.updateStatistics();
        this.loadAllReservations();
        this.populateBoothSelector();
    }
    
    populateBoothSelector() {
        const select = document.getElementById('adminBoothId');
        if (!select) return;
        select.innerHTML = AppConfig.booths.map(b => `<option value="${b.id}">${b.name} (${b.collegeName})</option>`).join('');
    }
    
    updateStatistics() {
        const today = new Date().toISOString().split('T')[0];
        
        document.getElementById('totalReservations').textContent = this.reservations.filter(r => r.date === today).length;
        document.getElementById('totalUsers').textContent = this.users.length;
        
        const totalSlots = AppConfig.booths.length * (AppConfig.businessHours.end - AppConfig.businessHours.start) * (60 / AppConfig.businessHours.slotDuration);
        const bookedSlots = this.reservations.filter(r => r.date === today).reduce((sum, r) => sum + (r.duration / AppConfig.businessHours.slotDuration), 0);
        document.getElementById('utilizationRate').textContent = `${totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0}%`;
    }

    loadAllReservations() {
        const emailFilter = document.getElementById('emailFilter')?.value.toLowerCase() || '';
        const dateFilter = document.getElementById('dateFilter')?.value || '';

        let reservations = this.reservations;
        
        if (emailFilter) {
            reservations = reservations.filter(r => r.email.toLowerCase().includes(emailFilter));
        }
        if (dateFilter) {
            reservations = reservations.filter(r => r.date === dateFilter);
        }
        
        const tbody = document.getElementById('adminReservationsList');
        if (!tbody) return;
        
        if (reservations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">該当する予約データがありません</td></tr>';
            return;
        }

        tbody.innerHTML = reservations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(res => `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 0.75rem;">${res.id.substring(4, 10)}...</td>
                <td style="padding: 0.75rem;">${res.email}</td>
                <td style="padding: 0.75rem;">${res.boothName}</td>
                <td style="padding: 0.75rem;">${res.date}</td>
                <td style="padding: 0.75rem;">${res.startTime} (${res.duration}分)</td>
                <td style="padding: 0.75rem;">${res.collegeName}</td>
                <td style="padding: 0.75rem; display: flex; gap: 5px;">
                    <button onclick="AdminControllerInstance.openEditModal('${res.id}')" style="background: var(--warning-color); color: white; border:none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">編集</button>
                    <button onclick="AdminControllerInstance.adminCancelReservation('${res.id}')" style="background: var(--danger-color); color: white; border:none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">削除</button>
                </td>
            </tr>
        `).join('');
    }
    
    clearFilters() {
        document.getElementById('emailFilter').value = '';
        document.getElementById('dateFilter').value = '';
        this.loadAllReservations();
    }

    openAddModal() {
        document.getElementById('adminReservationForm').reset();
        document.getElementById('adminReservationId').value = '';
        document.getElementById('adminModalTitle').textContent = '新規予約作成';
        ModalController.openModal('adminAddEditModal');
    }

    openEditModal(reservationId) {
        const reservation = this.reservations.find(r => r.id === reservationId);
        if (!reservation) return;

        document.getElementById('adminReservationId').value = reservation.id;
        document.getElementById('adminStudentEmail').value = reservation.email;
        document.getElementById('adminDate').value = reservation.date;
        document.getElementById('adminTime').value = reservation.startTime;
        document.getElementById('adminDuration').value = reservation.duration;
        document.getElementById('adminBoothId').value = reservation.boothId;
        document.getElementById('adminPurpose').value = reservation.purpose || '';
        document.getElementById('adminModalTitle').textContent = '予約編集';
        ModalController.openModal('adminAddEditModal');
    }

    // ======= saveReservation (Firestoreに保存/更新) =======
    async saveReservation(event) {
        event.preventDefault();
        
        const id = document.getElementById('adminReservationId').value;
        const email = document.getElementById('adminStudentEmail').value;
        const date = document.getElementById('adminDate').value;
        const startTime = document.getElementById('adminTime').value;
        const duration = parseInt(document.getElementById('adminDuration').value);
        const boothId = parseInt(document.getElementById('adminBoothId').value);
        const purpose = document.getElementById('adminPurpose').value;

        const user = await AuthController.getUserByEmail(email);
        if (!user) {
            NotificationService.show('指定されたメールアドレスのユーザーは存在しません', 'error');
            return;
        }
        
        const booth = AppConfig.booths.find(b => b.id === boothId);
        const studentId = email.split('@')[0];
        const collegeChar = studentId.charAt(4);
        const collegeName = AppConfig.collegeMap[collegeChar]?.name || '不明';

        let reservationData = {
            email, studentId, date, startTime, duration, boothId, purpose,
            boothName: booth.name,
            collegeName: collegeName,
            assignedCollegeName: booth.collegeName,
        };
        
        const reservationsCol = collection(window.db, "reservations");
        
        try {
            if (id) {
                // 更新
                const existingRes = this.reservations.find(r => r.id === id);
                if (!existingRes) throw new Error("Reservation not found in list.");
                
                // 更新時は既存のcreatedAtとdocIdを使う
                const docRef = doc(reservationsCol, existingRes.docId); 
                reservationData = { ...existingRes, ...reservationData };
                
                await updateDoc(docRef, reservationData);
                NotificationService.show('予約情報を更新しました', 'success');
            } else {
                // 新規作成
                const newDocRef = doc(reservationsCol);
                const newReservation = {
                    ...reservationData,
                    id: newDocRef.id,
                    createdAt: new Date().toISOString()
                };
                await setDoc(newDocRef, newReservation);
                
                await this.emailService.sendReservationNotification(newReservation, 'CONFIRM');
                NotificationService.show('予約情報を保存しました', 'success');
            }
        } catch(e) {
            console.error("Admin Save Error:", e);
            NotificationService.show('管理予約の保存/更新に失敗しました。', 'error');
            return;
        }

        ModalController.closeModal('adminAddEditModal');
        this.loadAdminData();
    }

    // ======= adminCancelReservation (Firestoreから削除) =======
    async adminCancelReservation(reservationId) {
        if (!confirm('この予約を削除してもよろしいですか？')) return;
        
        this.reservations = await this.getAllReservations();
        const canceled = this.reservations.find(r => r.id === reservationId);
        if (!canceled) return;
        
        const reservationDocRef = doc(window.db, "reservations", canceled.docId);
        
        try {
            await deleteDoc(reservationDocRef);
            await this.emailService.sendReservationNotification(canceled, 'CANCEL'); 
        } catch(e) {
            console.error("Admin Cancel Error:", e);
            NotificationService.show('管理予約の削除/キャンセルメール送信に失敗しました。', 'error');
            return;
        }
        
        NotificationService.show('予約を削除しました', 'success');
        this.loadAdminData();
    }
}

/**
 * ナビゲーションコントローラー
 */
const NavigationController = {
    navigateTo(pageName) {
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        const targetPage = document.getElementById(pageName + 'Page');
        if (targetPage) {
            targetPage.classList.add('active');
            this.handlePageLoad(pageName);
        }
    },
    handlePageLoad(pageName) {
        switch (pageName) {
            case 'reservation':
                ReservationController.initialize();
                break;
            case 'management':
                ReservationController.loadUserReservations();
                break;
            case 'admin':
                const currentUser = AuthController.getCurrentUser();
                if (currentUser && currentUser.isAdmin) {
                    AdminControllerInstance.loadAdminData();
                } else {
                    this.navigateTo('reservation');
                    NotificationService.show('管理者権限が必要です', 'error');
                }
                break;
        }
    }
};

/**
 * モーダルコントローラー
 */
const ModalController = {
    showConfirmModal(reservation) {
        const details = document.getElementById('confirmDetails');
        if (!details) return;
        details.innerHTML = `
            <p><strong>日付:</strong> ${reservation.date}</p>
            <p><strong>時間:</strong> ${reservation.startTime} から ${reservation.duration}分</p>
            <p><strong>割り当てブース:s</strong> ${reservation.boothName} (${reservation.assignedCollegeName})</p>
            ${reservation.isOtherCollege ? `<div class="alert alert-info" style="margin-top: 1rem;">注意: 他カレッジのブースが割り当てられました。担当者に通知が送信されます。</div>` : ''}
        `;
        this.openModal('confirmModal');
    },
    openModal(modalId) { 
        const modal = document.getElementById(modalId);
        if(modal) modal.style.display = 'block'; 
    },
    closeModal(modalId) { 
        const modal = document.getElementById(modalId);
        if(modal) modal.style.display = 'none';
    }
};

/**
 * 通知サービス
 */
const NotificationService = {
    show(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type}`;
        alertDiv.textContent = message;
        alertDiv.style.cssText = `position: fixed; top: 80px; right: 20px; z-index: 1001; max-width: 300px;`;
        document.body.appendChild(alertDiv);
        setTimeout(() => {
            alertDiv.style.opacity = '0';
            alertDiv.style.transition = 'opacity 0.5s';
            setTimeout(() => alertDiv.remove(), 500);
        }, 3000);
    }
};

/**
 * アプリケーション初期化
 */
const initializeApp = () => {
    const emailService = new EmailService();
    
    window.AuthController = new AuthenticationController(emailService);
    window.ReservationController = new ReservationManagementController(emailService);
    window.AdminControllerInstance = new AdminController(emailService);

    window.NavigationController = NavigationController;
    window.ModalController = ModalController;
    window.NotificationService = NotificationService;
    
    // AuthControllerは非同期処理を待たずに実行し、セッションがあればログイン状態にする
    // initialize() 自体が非同期になり、DBロード完了を待つように変更
    AuthController.initialize();

    // URLからの認証トークンをチェック (これも非同期)
    AuthController.checkVerificationFromURL();

    window.onclick = (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    };
    
    // ★デモ認証ボタンにイベントリスナーを追加 (Firestore対応)
    document.addEventListener('DOMContentLoaded', () => {
        const verifyButton = document.getElementById('verifyButton');
        const regEmailInput = document.getElementById('regEmail');
        
        if (verifyButton && regEmailInput) {
             verifyButton.addEventListener('click', () => {
                const email = regEmailInput.value || 'test@g.neec.ac.jp'; 
                AuthController.verifyUser(email);
            });
        }
    });
};


// DOMContentLoadedではなく、Firebaseのモジュールロード後に実行されることが望ましい
// index.htmlで app.js の読み込み順序を調整したため、ここで直接initializeAppを呼び出す
// document.addEventListener('DOMContentLoaded', initializeApp);
initializeApp();
