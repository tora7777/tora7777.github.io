'use strict';

/**
 * アプリケーション設定モジュール
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
    emailConfig: {
        domain: '@g.neec.ac.jp',
        pattern: /^k[0-9]{3}[a-z][0-9]{4}@g\.neec\.ac\.jp$/
    }
};

/**
 * メール送信サービス
 */
class EmailService {
    constructor() {
        this.SERVICE_ID = 'service_f0gi9iu';
        this.RESERVATION_NOTIFICATION_ID = 'template_yfflz44'; 
        this.PUBLIC_KEY = '9TmVa1GEItX3KSTKT'; 

        if (typeof emailjs !== 'undefined') {
            emailjs.init(this.PUBLIC_KEY);
        } else {
            console.error("EmailJS SDK not loaded.");
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

    sendReservationNotification(reservation, type) {
        const actionType = type === 'CONFIRM' ? '予約完了' : '予約キャンセル';
        const actionTypeStatus = type === 'CONFIRM' ? '完了' : 'キャンセル';

        const params = {
            to_email: reservation.email,
            student_id: reservation.studentId,
            action_type: actionType, 
            action_type_status: actionTypeStatus,
            reservation_details: `日付: ${reservation.date}\n時間: ${reservation.startTime} から ${reservation.duration}分\nブース: ${reservation.boothName} (${reservation.assignedCollegeName})\n予約ID: ${reservation.id}`
        };
        return this.send(this.RESERVATION_NOTIFICATION_ID, params);
    }
}


/**
 * 認証コントローラー (Firebase Authentication 対応)
 */
class AuthenticationController {
    constructor() { 
        this.currentUser = null;
        this.unsubscribe = null;
    }

    initialize() {
        // 認証状態の監視を開始
        this.unsubscribe = onAuthStateChanged(window.auth, async (user) => {
            if (user) {
                if (!user.emailVerified) {
                    NotificationService.show('メール認証が完了していません。受信ボックスを確認してください。', 'warning');
                    this.logout(); // 未認証の場合はログインさせない
                    return;
                }
                
                // 認証済みユーザーのプロフィール情報をFirestoreから取得
                const userProfile = await this.getUserProfile(user.uid);
                if (userProfile) {
                    this.currentUser = {
                        uid: user.uid,
                        email: user.email,
                        ...userProfile
                    };
                    this.showLoggedInState();
                } else {
                    // プロフィールがない場合 (稀なケース)
                    this.logout();
                }
            } else {
                // ログアウト状態
                this.currentUser = null;
                this.showLoggedOutState();
            }
        });
    }

    async getUserProfile(uid) {
        const userDocRef = doc(window.db, "users", uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
             const data = userDoc.data();
             const isAdminDoc = await getDoc(doc(window.db, "admins", uid));
             data.isAdmin = isAdminDoc.exists();
             return data;
        }
        return null;
    }

    async handleLogin(event) {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            await signInWithEmailAndPassword(window.auth, email, password);
            NotificationService.show('ログインしています...', 'info');
            // ログイン後の処理はonAuthStateChangedが担当
        } catch (error) {
            console.error("Login Error:", error);
            NotificationService.show('メールアドレスまたはパスワードが正しくありません。', 'error');
        }
    }

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

        try {
            const userCredential = await createUserWithEmailAndPassword(window.auth, email, password);
            const user = userCredential.user;

            // Firestoreにユーザープロフィールを作成
            const studentId = email.split('@')[0];
            const collegeChar = studentId.charAt(4);
            const userCollege = AppConfig.collegeMap[collegeChar] || { name: '不明' };
            
            const userProfile = {
                studentId: studentId,
                college: collegeChar,
                collegeName: userCollege.name,
                createdAt: new Date().toISOString()
            };
            await setDoc(doc(window.db, "users", user.uid), userProfile);
            
            // 認証メールを送信
            await sendEmailVerification(user);

            document.getElementById('registerForm').classList.add('hidden');
            document.getElementById('verificationMessage').classList.remove('hidden');

            NotificationService.show('確認メールを送信しました。メールを確認してください。', 'success');
            
        } catch (error) {
            console.error("Registration Error:", error);
            if (error.code === 'auth/email-already-in-use') {
                 NotificationService.show('このメールアドレスは既に使用されています', 'error');
            } else {
                 NotificationService.show('登録処理中にエラーが発生しました。', 'error');
            }
        }
    }

    showLoggedInState() {
        document.getElementById('header').classList.remove('hidden');
        document.getElementById('userEmail').textContent = this.currentUser.studentId;
        document.getElementById('adminLink').classList.toggle('hidden', !this.currentUser.isAdmin);
        NavigationController.navigateTo('reservation');
    }
    
    showLoggedOutState() {
        document.getElementById('header').classList.add('hidden');
        NavigationController.navigateTo('login');
    }

    logout() {
        signOut(window.auth);
        NotificationService.show('ログアウトしました', 'success');
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
    
    async loadReservations() {
        try {
            const reservationsCol = collection(window.db, "reservations");
            const reservationSnapshot = await getDocs(reservationsCol);
            this.reservations = reservationSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error("Failed to load reservations:", error);
            NotificationService.show('予約データのロードに失敗しました。', 'error');
            this.reservations = [];
        }
    }

    async initialize() {
        await this.loadReservations();
        const dateInput = document.getElementById('reservationDate');
        if (dateInput.value) {
            this.updateAvailability();
        } else {
            const timeSlotsContainer = document.getElementById('timeSlots');
            if(timeSlotsContainer) timeSlotsContainer.innerHTML = '<div class="time-slot-placeholder">日付を選択してください</div>';
        }
        this.setDateConstraints();
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

        const { start, end, slotDuration } = AppConfig.businessHours;
        let slotsHtml = '';
        for (let hour = start; hour < end; hour++) {
            for (let min = 0; min < 60; min += slotDuration) {
                const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
                slotsHtml += `<div class="time-slot" onclick="ReservationController.selectTime('${time}')" data-time="${time}">${time}</div>`;
            }
        }
        container.innerHTML = slotsHtml;
    }

    selectTime(time) {
        document.querySelectorAll('.time-slot.selected').forEach(slot => slot.classList.remove('selected'));
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
        document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('unavailable', 'selected'));
        this.selectedTime = null;

        const reservationsOnDate = this.reservations.filter(r => r.date === date);
        const bookedBoothsByTime = {};

        reservationsOnDate.forEach(r => {
            const [startHour, startMin] = r.startTime.split(':').map(Number);
            for (let i = 0; i < r.duration; i += AppConfig.businessHours.slotDuration) {
                const slotMinutes = (startHour * 60 + startMin) + i;
                const hour = Math.floor(slotMinutes / 60);
                const min = slotMinutes % 60;
                const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
                if (!bookedBoothsByTime[time]) bookedBoothsByTime[time] = new Set();
                bookedBoothsByTime[time].add(r.boothId);
            }
        });

        Object.entries(bookedBoothsByTime).forEach(([time, bookedBooths]) => {
             if (bookedBooths.size >= AppConfig.booths.length) {
                const slotEl = document.querySelector(`[data-time="${time}"]`);
                if (slotEl) slotEl.classList.add('unavailable');
             }
        });
    }

    assignBooth(date, startTime, duration) {
        const currentUser = AuthController.getCurrentUser();
        if (!currentUser) return null;
        
        const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
        const endMinutes = startMinutes + duration;

        const isBoothAvailable = (booth) => {
            return !this.reservations.some(r => {
                if (r.date !== date || r.boothId !== booth.id) return false;
                const resStart = parseInt(r.startTime.split(':')[0]) * 60 + parseInt(r.startTime.split(':')[1]);
                const resEnd = resStart + r.duration;
                return startMinutes < resEnd && endMinutes > resStart;
            });
        };
        
        const availableBooths = AppConfig.booths.filter(isBoothAvailable);
        if(availableBooths.length === 0) return null;
        
        availableBooths.sort((a, b) => {
            const countA = this.reservations.filter(r => r.boothId === a.id).length;
            const countB = this.reservations.filter(r => r.boothId === b.id).length;
            return countA - countB;
        });

        const ownCollegeBooth = availableBooths.find(b => b.college === currentUser.college);
        if (ownCollegeBooth) return ownCollegeBooth;
        const commonBooth = availableBooths.find(b => b.college === 'common');
        if (commonBooth) return commonBooth;
        
        return availableBooths[0];
    }

    handleReservation(event) {
        event.preventDefault();
        const currentUser = AuthController.getCurrentUser();
        if (!this.selectedTime || !currentUser) {
            NotificationService.show('時間を選択してください', 'error');
            return;
        }

        const date = document.getElementById('reservationDate').value;
        const duration = parseInt(document.getElementById('duration').value);
        const purpose = document.getElementById('purpose').value;
        const reminder = document.getElementById('reminder').checked;
        
        const assignedBooth = this.assignBooth(date, this.selectedTime, duration);
        if (!assignedBooth) {
            NotificationService.show('選択した時間帯に利用可能なブースがありません', 'error');
            return;
        }

        const isOtherCollege = assignedBooth.college !== currentUser.college && assignedBooth.college !== 'common';

        this.pendingReservation = {
            uid: currentUser.uid,
            studentId: currentUser.studentId,
            email: currentUser.email,
            boothId: assignedBooth.id,
            boothName: assignedBooth.name,
            collegeName: currentUser.collegeName,
            assignedCollegeName: assignedBooth.collegeName,
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
        
        try {
            const newDocRef = doc(collection(window.db, "reservations"));
            await setDoc(newDocRef, { ...this.pendingReservation, id: newDocRef.id });
            this.pendingReservation.id = newDocRef.id;

            await this.emailService.sendReservationNotification(this.pendingReservation, 'CONFIRM');

            ModalController.closeModal('confirmModal');
            NotificationService.show('予約が完了しました', 'success');
            this.resetReservationForm();
            await this.initialize(); 
        } catch (e) {
            console.error("Reservation Save Error:", e);
            NotificationService.show('予約の保存に失敗しました。権限を確認してください。', 'error');
        }
    }

    resetReservationForm() {
        document.getElementById('reservationDate').value = '';
        document.getElementById('duration').value = '60';
        document.getElementById('purpose').value = '';
        document.getElementById('reminder').checked = false;
        this.selectedTime = null;
        this.pendingReservation = null;
        this.updateAvailability();
    }
    
    async loadUserReservations() {
        const container = document.getElementById('userReservations');
        const currentUser = AuthController.getCurrentUser();
        if (!container || !currentUser) return;
        
        await this.loadReservations();
        const userReservations = this.reservations
            .filter(r => r.uid === currentUser.uid)
            .sort((a, b) => new Date(`${a.date}T${a.startTime}`) - new Date(`${b.date}T${b.startTime}`));
        
        if (userReservations.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">予約はありません</p>';
            return;
        }
        
        container.innerHTML = userReservations.map(res => {
            const isPast = new Date(`${res.date}T${res.startTime}`) < new Date();
            return `
                <div class="reservation-item" style="opacity: ${isPast ? '0.6' : '1'};">
                    <div>
                        <h4>${res.date} ${res.startTime} ${isPast ? ' (終了)' : ''}</h4>
                        <p>ブース: ${res.boothName} | 時間: ${res.duration}分</p>
                    </div>
                    <div>
                        ${!isPast ? `<button class="btn btn-danger" onclick="ReservationController.cancelReservation('${res.id}')">キャンセル</button>` : ''}
                    </div>
                </div>`;
        }).join('');
    }

    async cancelReservation(reservationId) {
        if (!confirm('本当にこの予約をキャンセルしますか？')) return;
        
        const reservationToCancel = this.reservations.find(r => r.id === reservationId);
        if (!reservationToCancel) return;
        
        try {
            await deleteDoc(doc(window.db, "reservations", reservationId));
            await this.emailService.sendReservationNotification(reservationToCancel, 'CANCEL');
            NotificationService.show('予約をキャンセルしました', 'success');
            await this.loadUserReservations();
            await this.initialize();
        } catch (e) {
            console.error("Cancel Error:", e);
            NotificationService.show('予約のキャンセルに失敗しました。', 'error');
        }
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
    
    async loadAdminData() {
        try {
            const resSnapshot = await getDocs(collection(window.db, "reservations"));
            this.reservations = resSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const usersSnapshot = await getDocs(collection(window.db, "users"));
            this.users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            this.updateStatistics();
            this.loadAllReservations();
            this.populateBoothSelector();
        } catch(e) {
            console.error("Admin Load Data Error:", e);
            NotificationService.show("管理者データの読み込みに失敗しました。", "error");
        }
    }
    
    populateBoothSelector() {
        const select = document.getElementById('adminBoothId');
        if (select) {
            select.innerHTML = AppConfig.booths.map(b => `<option value="${b.id}">${b.name} (${b.collegeName})</option>`).join('');
        }
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
        const emailFilter = document.getElementById('emailFilter').value.toLowerCase();
        const dateFilter = document.getElementById('dateFilter').value;

        let filtered = this.reservations;
        if (emailFilter) filtered = filtered.filter(r => r.email.toLowerCase().includes(emailFilter));
        if (dateFilter) filtered = filtered.filter(r => r.date === dateFilter);
        
        const tbody = document.getElementById('adminReservationsList');
        if (!tbody) return;
        tbody.innerHTML = filtered.length === 0 ? '<tr><td colspan="7" style="text-align: center; padding: 2rem;">該当なし</td></tr>' :
            filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(res => `
                <tr>
                    <td>${res.id.substring(0, 6)}...</td>
                    <td>${res.email}</td>
                    <td>${res.boothName}</td>
                    <td>${res.date}</td>
                    <td>${res.startTime} (${res.duration}分)</td>
                    <td>${res.collegeName}</td>
                    <td>
                        <button class="btn btn-warning" onclick="AdminControllerInstance.openEditModal('${res.id}')">編集</button>
                        <button class="btn btn-danger" onclick="AdminControllerInstance.adminCancelReservation('${res.id}')">削除</button>
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
        const res = this.reservations.find(r => r.id === reservationId);
        if (!res) return;
        document.getElementById('adminReservationId').value = res.id;
        document.getElementById('adminStudentEmail').value = res.email;
        document.getElementById('adminDate').value = res.date;
        document.getElementById('adminTime').value = res.startTime;
        document.getElementById('adminDuration').value = res.duration;
        document.getElementById('adminBoothId').value = res.boothId;
        document.getElementById('adminPurpose').value = res.purpose || '';
        document.getElementById('adminModalTitle').textContent = '予約編集';
        ModalController.openModal('adminAddEditModal');
    }

    async saveReservation(event) {
        event.preventDefault();
        const id = document.getElementById('adminReservationId').value;
        const email = document.getElementById('adminStudentEmail').value;
        const user = this.users.find(u => u.studentId === email.split('@')[0]);
        if (!user) {
            NotificationService.show('指定されたメールアドレスのユーザーが存在しません', 'error');
            return;
        }
        const boothId = parseInt(document.getElementById('adminBoothId').value);
        const booth = AppConfig.booths.find(b => b.id === boothId);

        let reservationData = {
            uid: user.id,
            email,
            studentId: user.studentId,
            date: document.getElementById('adminDate').value,
            startTime: document.getElementById('adminTime').value,
            duration: parseInt(document.getElementById('adminDuration').value),
            boothId: booth.id,
            purpose: document.getElementById('adminPurpose').value,
            boothName: booth.name,
            collegeName: user.collegeName,
            assignedCollegeName: booth.collegeName,
            createdAt: new Date().toISOString(),
        };
        
        try {
            const docRef = id ? doc(window.db, "reservations", id) : doc(collection(window.db, "reservations"));
            await setDoc(docRef, { ...reservationData, id: docRef.id }, { merge: !!id });
            NotificationService.show('予約情報を保存しました', 'success');
            ModalController.closeModal('adminAddEditModal');
            await this.loadAdminData();
        } catch(e) {
            console.error("Admin Save Error:", e);
            NotificationService.show('予約の保存/更新に失敗しました。', 'error');
        }
    }

    async adminCancelReservation(reservationId) {
        if (!confirm('この予約を削除してもよろしいですか？')) return;
        const canceled = this.reservations.find(r => r.id === reservationId);
        if (!canceled) return;
        
        try {
            await deleteDoc(doc(window.db, "reservations", reservationId));
            await this.emailService.sendReservationNotification(canceled, 'CANCEL');
            NotificationService.show('予約を削除しました', 'success');
            await this.loadAdminData();
        } catch(e) {
            console.error("Admin Cancel Error:", e);
            NotificationService.show('予約の削除に失敗しました。', 'error');
        }
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
            ${reservation.isOtherCollege ? `<div class="alert alert-info">注意: 他カレッジのブースが割り当てられました。</div>` : ''}
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
        document.body.appendChild(alertDiv);
        setTimeout(() => alertDiv.remove(), 4000);
    }
};

/**
 * アプリケーション初期化
 */
const initializeApp = () => {
    // Firebaseのグローバルオブジェクトが利用可能になるのを待つ
    const waitForFirebase = setInterval(() => {
        if (window.auth && window.db) {
            clearInterval(waitForFirebase);

            const emailService = new EmailService();
            
            window.AuthController = new AuthenticationController();
            window.ReservationController = new ReservationManagementController(emailService);
            window.AdminControllerInstance = new AdminController(emailService);

            window.NavigationController = NavigationController;
            window.ModalController = ModalController;
            window.NotificationService = NotificationService;
            
            AuthController.initialize();

            window.onclick = (event) => {
                if (event.target.classList.contains('modal')) {
                    event.target.style.display = 'none';
                }
            };
        }
    }, 100);
};

// DOMContentLoadedを待ってから初期化処理を実行
document.addEventListener('DOMContentLoaded', initializeApp);
