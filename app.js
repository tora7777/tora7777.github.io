'use strict';

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
 * データストレージモジュール
 * LocalStorageを使用したデータ永続化層
 */
class DataStorage {
    constructor() {
        this.storagePrefix = 'reservation_system_';
    }
    save(key, value) {
        try {
            localStorage.setItem(this.storagePrefix + key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage save error:', error);
            return false;
        }
    }
    load(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(this.storagePrefix + key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('Storage load error:', error);
            return defaultValue;
        }
    }
}

/**
 * メール送信サービス
 * EmailJSと連携してメールを送信する
 * 予約通知とキャンセル通知のテンプレートを統合 (2つに削減)
 */
class EmailService {
    constructor() {
        this.SERVICE_ID = 'service_f0gi9iu';
        this.VERIFICATION_TEMPLATE_ID = 'template_8ybqr9d'; // 1. 認証メール用テンプレートID (変更なし)
        // ★★★ 確認したEmailJSの統合テンプレートIDに置き換えてください ★★★
        this.RESERVATION_NOTIFICATION_ID = 'template_reservation_notify'; // 例: 'template_yfflz44'
        this.PUBLIC_KEY = '9TmVa1GEItX3KSTKT';

        if (typeof emailjs !== 'undefined') {
            emailjs.init(this.PUBLIC_KEY);
        } else {
            console.error("EmailJS SDK not loaded. Please check the script tag in your HTML.");
        }
    }

    /**
     * メールを送信する汎用メソッド
     */
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
     * ユーザー認証メールを送信
     */
    sendVerificationEmail(toEmail) {
        const verificationToken = this.generateVerificationToken();
        const verificationLink = `${window.location.origin}${window.location.pathname}?token=${verificationToken}&email=${encodeURIComponent(toEmail)}`;
        
        const tokens = JSON.parse(localStorage.getItem('verification_tokens') || '{}');
        tokens[toEmail] = {
            token: verificationToken,
            expiry: Date.now() + 24 * 60 * 60 * 1000 // 24時間有効
        };
        localStorage.setItem('verification_tokens', JSON.stringify(tokens));

        const params = {
            to_email: toEmail,
            verification_link: verificationLink
        };
        return this.send(this.VERIFICATION_TEMPLATE_ID, params);
    }

    /**
     * 予約完了またはキャンセルメールを送信する統合メソッド
     * @param {object} reservation - 予約データ
     * @param {string} type - 'CONFIRM' または 'CANCEL'
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
            action_type: actionType, // Subject用: 予約完了 / 予約キャンセル
            action_type_status: actionTypeStatus, // Content用: 完了 / キャンセル
            reservation_details: `
                日付: ${reservation.date}
                時間: ${reservation.startTime} から ${reservation.duration}分
                ブース: ${reservation.boothName} (${reservation.assignedCollegeName})
                予約ID: ${reservation.id}
            `
        };

        return this.send(this.RESERVATION_NOTIFICATION_ID, params);
    }

    // sendConfirmationEmail と sendCancellationEmail は削除または廃止

    /**
     * 認証トークンを生成
     */
    generateVerificationToken() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    }

    /**
     * 認証トークンを検証
     */
    verifyToken(email, token) {
        const tokens = JSON.parse(localStorage.getItem('verification_tokens') || '{}');
        const storedData = tokens[email];
        
        if (!storedData) return false;
        if (storedData.token !== token) return false;
        if (Date.now() > storedData.expiry) return false;
        
        delete tokens[email];
        localStorage.setItem('verification_tokens', JSON.stringify(tokens));
        
        return true;
    }
}

/**
 * 認証コントローラー
 * ユーザー認証とセッション管理
 */
class AuthenticationController {
    constructor(storage, emailService) {
        this.storage = storage;
        this.emailService = emailService;
        this.currentUser = null;
        this.users = this.storage.load('users', []);
    }

    initialize() {
        const savedUser = this.storage.load('currentUser');
        if (savedUser) {
            this.currentUser = savedUser;
            this.showLoggedInState();
        }
    }

    // ======= handleLogin 置き換え =======
    handleLogin(event) {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        const user = this.users.find(u => u.email === email);

        if (!user) {
            NotificationService.show('メールアドレスまたはパスワードが正しくありません', 'error');
            return;
        }

        // ハッシュ化されたパスワードと比較
        if (user.password !== this.hashPassword(password)) {
            NotificationService.show('メールアドレスまたはパスワードが正しくありません', 'error');
            return;
        }

        if (!user.verified) {
            NotificationService.show('メールアドレスが認証されていません。認証メール内のリンクをクリックしてください。', 'error');
            // 再送信オプションを表示
            if (confirm('認証メールを再送信しますか？')) {
                this.resendVerificationEmail(email);
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
        };

        this.storage.save('currentUser', this.currentUser);
        this.showLoggedInState();
        NotificationService.show('ログインしました', 'success');
    }

    // ======= handleRegister 置き換え =======
    async handleRegister(event) {
        event.preventDefault();
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;
        const passwordConfirm = document.getElementById('regPasswordConfirm').value;

        // バリデーション
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
        if (this.users.some(u => u.email === email)) {
            NotificationService.show('このメールアドレスは既に使用されています', 'error');
            return;
        }

        // ユーザーを仮登録
        const newUser = {
            email: email,
            password: this.hashPassword(password), // パスワードをハッシュ化
            verified: false,
            createdAt: new Date().toISOString()
        };
        
        this.users.push(newUser);
        this.storage.save('users', this.users);

        // 認証メールを送信
        try {
            await this.emailService.sendVerificationEmail(email);
            
            // 成功メッセージを表示
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
            NotificationService.show('メール送信に失敗しました。時間をおいて再度お試しください。', 'error');
            // エラーの場合は登録を取り消す
            this.users = this.users.filter(u => u.email !== email);
            this.storage.save('users', this.users);
        }
    }

    // ======= 新規追加メソッド =======
    /**
     * URLパラメータから認証トークンを確認し、自動認証を行う
     */
    checkVerificationFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const email = urlParams.get('email');
        
        if (token && email) {
            this.verifyUserWithToken(email, token);
        }
    }

    /**
     * トークンを使用してユーザーを認証
     */
    verifyUserWithToken(email, token) {
        if (this.emailService.verifyToken(email, token)) {
            const user = this.users.find(u => u.email === email);
            if (user) {
                user.verified = true;
                this.storage.save('users', this.users);
                NotificationService.show('メールアドレスの認証が完了しました！ログインしてください。', 'success');
                window.history.replaceState({}, document.title, window.location.pathname);
                this.showLoginForm();
            } else {
                NotificationService.show('ユーザーが見つかりません。新規登録してください。', 'error');
            }
        } else {
            NotificationService.show('認証リンクが無効または期限切れです。', 'error');
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

    /**
     * 認証メールの再送信
     */
    async resendVerificationEmail(email) {
        try {
            await this.emailService.sendVerificationEmail(email);
            NotificationService.show('認証メールを再送信しました。', 'success');
        } catch (error) {
            NotificationService.show('メールの再送信に失敗しました。', 'error');
        }
    }

    // ======= verifyUser（デモ用）=======
    verifyUser(email) {
        const user = this.users.find(u => u.email === email);
        if (user) {
            user.verified = true;
            this.storage.save('users', this.users);
            NotificationService.show('メールアドレスが認証されました。ログインしてください。', 'success');
            document.getElementById('verificationMessage').classList.add('hidden');
            this.showLoginForm();
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
            this.storage.save('currentUser', null);
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
 * 予約の作成、更新、削除を管理
 */
class ReservationManagementController {
    constructor(storage, emailService) {
        this.storage = storage;
        this.emailService = emailService;
        this.reservations = [];
    }

    initialize() {
        this.loadReservations();
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

    loadReservations() {
        this.reservations = this.storage.load('reservations', []);
    }

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

        // Only render slots if they don't exist yet
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
            id: `RES-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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

    async confirmReservation() {
        if (!this.pendingReservation) return;

        // ★統合したメール送信メソッドを使用
        try {
            await this.emailService.sendReservationNotification(this.pendingReservation, 'CONFIRM');
        } catch(error) {
            // エラー通知をより明確にする
            console.error("予約完了メール送信エラー:", error);
            NotificationService.show('メール送信に失敗しました。予約は完了しています。EmailJSの設定を確認してください。', 'error');
            // メール送信に失敗しても予約処理は続行
        }

        this.reservations.push(this.pendingReservation);
        this.storage.save('reservations', this.reservations);

        if (this.pendingReservation.isOtherCollege) {
            console.log(`Slack通知送信: ${this.pendingReservation.email}が${this.pendingReservation.assignedCollegeName}のブースを予約しました。`);
        }

        ModalController.closeModal('confirmModal');
        NotificationService.show('予約が完了しました', 'success');
        this.resetReservationForm();
        this.initialize();
    }

    resetReservationForm() {
        document.getElementById('reservationDate').value = '';
        document.getElementById('duration').value = '60';
        document.getElementById('purpose').value = '';
        document.getElementById('reminder').checked = false;
        this.selectedTime = null;
        this.pendingReservation = null;
    }

    loadUserReservations() {
        const container = document.getElementById('userReservations');
        const currentUser = AuthController.getCurrentUser();
        if (!container || !currentUser) return;

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

    async cancelReservation(reservationId) {
        if (!confirm('本当にこの予約をキャンセルしますか？')) return;
        const index = this.reservations.findIndex(r => r.id === reservationId);
        if (index === -1) return;
        
        const canceled = this.reservations[index]; // キャンセルされた予約オブジェクトを取得

        // ★統合したメール送信メソッドを使用
        try {
            await this.emailService.sendReservationNotification(canceled, 'CANCEL'); // 取得したオブジェクトと 'CANCEL' を渡す
        } catch(error) {
            // エラー通知をより明確にする
            console.error("予約キャンセルメール送信エラー:", error);
            NotificationService.show('キャンセルメールの送信に失敗しました。EmailJSの設定を確認してください。', 'error');
        }

        this.reservations.splice(index, 1);
        this.storage.save('reservations', this.reservations);
        NotificationService.show('予約をキャンセルしました', 'success');
        this.loadUserReservations();
    }
}

/**
 * 管理者コントローラー
 */
class AdminController {
    constructor(storage, emailService) {
        this.storage = storage;
        this.emailService = emailService; // ★EmailServiceを受け取る
    }

    loadAdminData() {
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
        const reservations = this.storage.load('reservations', []);
        const users = this.storage.load('users', []);
        const today = new Date().toISOString().split('T')[0];
        
        document.getElementById('totalReservations').textContent = reservations.filter(r => r.date === today).length;
        document.getElementById('totalUsers').textContent = users.length;
        
        const totalSlots = AppConfig.booths.length * (AppConfig.businessHours.end - AppConfig.businessHours.start) * (60 / AppConfig.businessHours.slotDuration);
        const bookedSlots = reservations.filter(r => r.date === today).reduce((sum, r) => sum + (r.duration / AppConfig.businessHours.slotDuration), 0);
        document.getElementById('utilizationRate').textContent = `${totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0}%`;
    }

    loadAllReservations() {
        const emailFilter = document.getElementById('emailFilter')?.value.toLowerCase() || '';
        const dateFilter = document.getElementById('dateFilter')?.value || '';

        let reservations = this.storage.load('reservations', []);
        
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
        const reservations = this.storage.load('reservations', []);
        const reservation = reservations.find(r => r.id === reservationId);
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

    async saveReservation(event) {
        event.preventDefault();
        let reservations = this.storage.load('reservations', []);
        const users = this.storage.load('users', []);

        const id = document.getElementById('adminReservationId').value;
        const email = document.getElementById('adminStudentEmail').value;
        const date = document.getElementById('adminDate').value;
        const startTime = document.getElementById('adminTime').value;
        const duration = parseInt(document.getElementById('adminDuration').value);
        const boothId = parseInt(document.getElementById('adminBoothId').value);
        const purpose = document.getElementById('adminPurpose').value;

        if (!users.some(u => u.email === email)) {
            NotificationService.show('指定されたメールアドレスのユーザーは存在しません', 'error');
            return;
        }
        
        const booth = AppConfig.booths.find(b => b.id === boothId);
        const studentId = email.split('@')[0];
        const collegeChar = studentId.charAt(4);
        const collegeName = AppConfig.collegeMap[collegeChar]?.name || '不明';

        const reservationData = {
            email, studentId, date, startTime, duration, boothId, purpose,
            boothName: booth.name,
            collegeName: collegeName,
            assignedCollegeName: booth.collegeName,
            createdAt: new Date().toISOString()
        };
        
        const isNewReservation = !id;
        if (id) {
            const index = reservations.findIndex(r => r.id === id);
            if (index !== -1) {
                reservations[index] = { ...reservations[index], ...reservationData };
            }
        } else {
            const newReservation = {
                ...reservationData,
                id: `RES-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            };
            reservations.push(newReservation);
            
            // ★新規作成時のみメール送信
            try {
                await this.emailService.sendReservationNotification(newReservation, 'CONFIRM');
            } catch(e) {
                // エラー通知をより明確にする
                console.error("管理者による新規予約メール送信エラー:", e);
                NotificationService.show('メール送信に失敗しました。予約は完了しています。EmailJSの設定を確認してください。', 'error');
            }
        }
        
        this.storage.save('reservations', reservations);
        NotificationService.show('予約情報を保存しました', 'success');
        ModalController.closeModal('adminAddEditModal');
        this.loadAdminData();
    }

    async adminCancelReservation(reservationId) {
        if (!confirm('この予約を削除してもよろしいですか？')) return;
        let reservations = this.storage.load('reservations', []);
        const canceled = reservations.find(r => r.id === reservationId); // キャンセルされた予約オブジェクトを取得
        if (!canceled) return;
        
        try {
            // ★統合したメール送信メソッドを使用
            await this.emailService.sendReservationNotification(canceled, 'CANCEL'); // 取得したオブジェクトと 'CANCEL' を渡す
        } catch(e) {
            // エラー通知をより明確にする
            console.error("管理者による予約キャンセルメール送信エラー:", e);
            NotificationService.show('キャンセルメールの送信に失敗しました。EmailJSの設定を確認してください。', 'error');
        }

        reservations = reservations.filter(r => r.id !== reservationId);
        this.storage.save('reservations', reservations);
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
            <p><strong>割り当てブース:</strong> ${reservation.boothName} (${reservation.assignedCollegeName})</p>
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
    const storage = new DataStorage();
    const emailService = new EmailService();
    
    window.AuthController = new AuthenticationController(storage, emailService);
    window.ReservationController = new ReservationManagementController(storage, emailService);
    window.AdminControllerInstance = new AdminController(storage, emailService);

    window.NavigationController = NavigationController;
    window.ModalController = ModalController;
    window.NotificationService = NotificationService;
    
    AuthController.initialize();

    // ★新規追加：URLパラメータから認証トークンをチェック
    AuthController.checkVerificationFromURL();

    window.onclick = (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    };
};


document.addEventListener('DOMContentLoaded', initializeApp);
