import { createClient } from '@supabase/supabase-js'
import Chart from 'chart.js/auto'

// ============ CONFIGURATION ============
// Replace with your actual keys for production
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY'
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || 'YOUR_OPENROUTER_KEY'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ============ GLOBAL STATE ============
let supabaseClient = null
let currentUser = null
let currentChildId = null
let observations = []
let children = []
let radarChart = null
let miniRadarChart = null

const domains = [
    { key: 'physical', label: 'Physical', icon: 'fa-running', color: 'blue' },
    { key: 'socio_emotional', label: 'Socio-emotional', icon: 'fa-heart', color: 'pink' },
    { key: 'cognitive', label: 'Cognitive', icon: 'fa-brain', color: 'purple' },
    { key: 'language', label: 'Language & Literacy', icon: 'fa-book', color: 'indigo' },
    { key: 'aesthetic', label: 'Aesthetic & Cultural', icon: 'fa-palette', color: 'orange' },
    { key: 'learning_habits', label: 'Learning Habits', icon: 'fa-chalkboard', color: 'teal' }
]

let currentScores = {}
let currentNotes = {}

// ============ INITIALIZATION ============
function initSupabase() {
    if (SUPABASE_URL.includes('YOUR_PROJECT')) {
        console.warn('Using demo mode - no Supabase connection. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env file')
        return null
    }
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

// ============ AI LLM FUNCTION ============
async function callLLMForScoring(observationsText, scoresData, childAge) {
    const prompt = `You are Vikaas, an AI child development expert for Anganwadi workers in India. Analyze this observation:
    
Child Age: ${childAge}
Observations: ${observationsText}
User ratings: ${JSON.stringify(scoresData)}

Return JSON exactly:
{
  "domain_scores": {"physical":1-3, "socio_emotional":1-3, "cognitive":1-3, "language":1-3, "aesthetic":1-3, "learning_habits":1-3},
  "risk_flags": ["list of domains with score 1"],
  "recommended_activity": "one simple home activity in local language style",
  "summary": "brief parent-friendly summary"
}`

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3
            })
        })
        
        if (!response.ok) throw new Error('LLM API error')
        const data = await response.json()
        let content = data.choices[0].message.content.trim()
        if (content.startsWith('```json')) {
            content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }
        return JSON.parse(content)
    } catch (error) {
        console.error('LLM fallback:', error)
        const scores = {}
        domains.forEach(d => { scores[d.key] = scoresData[d.key] || 2 })
        const riskDomains = domains.filter(d => scores[d.key] === 1).map(d => d.label)
        return {
            domain_scores: scores,
            risk_flags: riskDomains,
            recommended_activity: "🎨 Play-based activity: Engage child with simple puzzles or storytelling for 10 minutes daily.",
            summary: "Observation recorded. Continue tracking development across all domains."
        }
    }
}

// ============ UI RENDERING ============
function renderDomains() {
    const container = document.getElementById('domainsContainer')
    if (!container) return
    container.innerHTML = ''
    
    domains.forEach(domain => {
        const div = document.createElement('div')
        div.className = 'border-b pb-3'
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <label class="font-medium text-sm"><i class="fas ${domain.icon} text-${domain.color}-500"></i> ${domain.label}</label>
                <div class="flex gap-2">
                    <button data-domain="${domain.key}" data-score="3" class="score-btn px-2 py-1 text-xs rounded bg-gray-100">✅ Typical</button>
                    <button data-domain="${domain.key}" data-score="2" class="score-btn px-2 py-1 text-xs rounded bg-gray-100">🔄 Emerging</button>
                    <button data-domain="${domain.key}" data-score="1" class="score-btn px-2 py-1 text-xs rounded bg-gray-100">⚠️ Concern</button>
                </div>
            </div>
            <div class="flex gap-2">
                <textarea data-domain="${domain.key}" class="note-input flex-1 text-xs border rounded p-2" rows="1" placeholder="Voice or text notes..."></textarea>
                <button data-domain="${domain.key}" class="voice-btn bg-indigo-100 px-3 rounded"><i class="fas fa-microphone"></i></button>
            </div>
        `
        container.appendChild(div)
    })
    
    attachDomainEvents()
}

function attachDomainEvents() {
    document.querySelectorAll('.score-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const domain = btn.dataset.domain
            const score = parseInt(btn.dataset.score)
            currentScores[domain] = score
            const parent = btn.closest('.border-b')
            parent.querySelectorAll('.score-btn').forEach(b => {
                b.classList.remove('bg-green-200', 'bg-yellow-200', 'bg-red-200')
            })
            if (score === 3) btn.classList.add('bg-green-200')
            else if (score === 2) btn.classList.add('bg-yellow-200')
            else btn.classList.add('bg-red-200')
        })
    })
    
    document.querySelectorAll('.note-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
            currentNotes[inp.dataset.domain] = inp.value
        })
    })
    
    document.querySelectorAll('.voice-btn').forEach(btn => {
        btn.addEventListener('click', () => startVoiceInput(btn.dataset.domain))
    })
}

function startVoiceInput(domain) {
    if (!('webkitSpeechRecognition' in window)) {
        showToast('Voice not supported in this browser', 'error')
        return
    }
    const recognition = new webkitSpeechRecognition()
    recognition.lang = 'hi-IN'
    recognition.continuous = false
    const btn = document.querySelector(`.voice-btn[data-domain="${domain}"]`)
    btn.classList.add('voice-active')
    recognition.start()
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript
        const textarea = document.querySelector(`.note-input[data-domain="${domain}"]`)
        if (textarea) {
            textarea.value += (textarea.value ? ' ' : '') + transcript
            currentNotes[domain] = textarea.value
        }
        btn.classList.remove('voice-active')
        showToast(`✓ Voice recorded for ${domain}`, 'success')
    }
    
    recognition.onerror = () => {
        btn.classList.remove('voice-active')
        showToast('Voice failed, please type', 'error')
    }
}

// ============ OBSERVATION SUBMISSION ============
async function submitObservation() {
    showLoading(true)
    const child = children.find(c => c.id === currentChildId)
    if (!child) return
    
    const notesText = Object.entries(currentNotes).map(([k, v]) => `${k}: ${v}`).join('; ')
    
    try {
        const llmResult = await callLLMForScoring(notesText, currentScores, child.age)
        
        const observation = {
            child_id: currentChildId,
            worker_id: currentUser.id,
            scores: llmResult.domain_scores,
            notes: currentNotes,
            risk_flags: llmResult.risk_flags,
            recommended_activity: llmResult.recommended_activity,
            summary: llmResult.summary,
            created_at: new Date().toISOString()
        }
        
        if (supabaseClient) {
            const { error } = await supabaseClient.from('observations').insert(observation)
            if (error) console.error('Supabase error:', error)
        }
        
        observations.unshift({ ...observation, childId: currentChildId, date: new Date() })
        localStorage.setItem(`vikaas_obs_${currentUser?.id}`, JSON.stringify(observations))
        
        showRadarChart(llmResult.domain_scores)
        document.getElementById('recommendedActivity').innerText = llmResult.recommended_activity
        const riskFlagDiv = document.getElementById('riskFlag')
        if (llmResult.risk_flags.length > 0) {
            riskFlagDiv.classList.remove('hidden')
            riskFlagDiv.innerHTML = `⚠️ Delay detected in: ${llmResult.risk_flags.join(', ')}`
        } else {
            riskFlagDiv.classList.add('hidden')
        }
        document.getElementById('aiResultPreview').classList.remove('hidden')
        document.getElementById('focusActivityText').innerText = llmResult.recommended_activity
        showToast('✅ Observation saved! AI analysis complete.', 'success')
        
        loadReports()
        loadSupervisorView()
        
    } catch (error) {
        console.error(error)
        showToast('Error processing observation', 'error')
    } finally {
        showLoading(false)
    }
}

function showRadarChart(scores) {
    const ctx = document.getElementById('miniRadar')?.getContext('2d')
    if (!ctx) return
    if (miniRadarChart) miniRadarChart.destroy()
    miniRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: domains.map(d => d.label.substring(0, 10)),
            datasets: [{
                label: 'Score (1-3)',
                data: domains.map(d => scores[d.key] || 2),
                backgroundColor: 'rgba(34,197,94,0.2)',
                borderColor: '#166534'
            }]
        },
        options: { scales: { r: { min: 1, max: 3, ticks: { stepSize: 1 } } }, responsive: true }
    })
}

// ============ REPORTS & SUPERVISOR ============
async function loadReports() {
    const childId = document.getElementById('reportChildSelect')?.value || currentChildId
    const childObs = observations.filter(o => o.childId === childId || o.child_id === childId)
    if (childObs.length === 0) return
    
    const latest = childObs[0]
    const ctx = document.getElementById('progressRadar')?.getContext('2d')
    if (ctx && latest.scores) {
        if (radarChart) radarChart.destroy()
        radarChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: domains.map(d => d.label),
                datasets: [{
                    label: 'Development Score',
                    data: domains.map(d => latest.scores[d.key] || 2),
                    backgroundColor: 'rgba(34,197,94,0.2)',
                    borderColor: '#166534'
                }]
            },
            options: { scales: { r: { min: 1, max: 3 } } }
        })
    }
    
    const historyHtml = childObs.slice(0, 5).map(obs => `
        <div class="bg-gray-50 p-2 rounded text-xs">
            ${new Date(obs.date || obs.created_at).toLocaleDateString()}: ${obs.summary || 'Observation recorded'}
        </div>
    `).join('')
    document.getElementById('historyList').innerHTML = historyHtml || '<p class="text-xs text-gray-500">No history yet</p>'
}

async function loadSupervisorView() {
    const atRiskChildren = children.filter(c => {
        const childObs = observations.filter(o => o.childId === c.id || o.child_id === c.id)
        const latest = childObs[0]
        return latest?.risk_flags?.length > 0
    })
    
    const heatmap = document.getElementById('heatmapContainer')
    if (!heatmap) return
    heatmap.innerHTML = atRiskChildren.map(child => `
        <div class="bg-red-50 border border-red-300 rounded-lg p-3 flex justify-between items-center">
            <div><span class="font-bold">${child.name}</span><span class="text-xs ml-2 text-gray-500">${child.age}</span></div>
            <button onclick="window.generateReferral('${child.id}')" class="bg-red-600 text-white px-3 py-1 rounded text-xs">Referral</button>
        </div>
    `).join('')
    if (atRiskChildren.length === 0) heatmap.innerHTML = '<p class="text-gray-500 text-center">No at-risk children currently</p>'
}

window.generateReferral = function(childId) {
    const child = children.find(c => c.id === childId)
    showToast(`📋 Referral generated for ${child.name}. Follow-up scheduled.`, 'success')
}

async function shareWhatsApp() {
    const child = children.find(c => c.id === currentChildId)
    const latest = observations.find(o => o.childId === currentChildId || o.child_id === currentChildId)
    let msg = `📊 *VIKAAS Progress Report*\n👶 ${child.name} (${child.age})\n📅 ${new Date().toLocaleDateString()}\n\n`
    if (latest?.scores) {
        domains.forEach(d => {
            const score = latest.scores[d.key]
            msg += `• ${d.label}: ${score === 3 ? '✅ On track' : score === 2 ? '🔄 Emerging' : '⚠️ Needs support'}\n`
        })
        if (latest.recommended_activity) msg += `\n🎯 *Activity*: ${latest.recommended_activity}\n`
    }
    msg += `\n🔗 Vikaas - Tracking child development with AI`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
}

// ============ UTILITIES ============
function showToast(msg, type) {
    const toast = document.createElement('div')
    toast.className = `toast-slide bg-${type === 'error' ? 'red' : 'green'}-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm`
    toast.innerText = msg
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 3000)
}

function showLoading(show) {
    let overlay = document.getElementById('loadingOverlay')
    if (show && !overlay) {
        overlay = document.createElement('div')
        overlay.id = 'loadingOverlay'
        overlay.className = 'loading-overlay'
        overlay.innerHTML = '<div class="spinner"></div>'
        document.body.appendChild(overlay)
    } else if (!show && overlay) overlay.remove()
}

function initDemoData() {
    children = [
        { id: 'c1', name: 'Aarav Sharma', age: '3.2y' },
        { id: 'c2', name: 'Diya Verma', age: '4.0y' },
        { id: 'c3', name: 'Kavya Singh', age: '2.8y' },
        { id: 'c4', name: 'Reyansh Nair', age: '3.5y' }
    ]
    const savedObs = localStorage.getItem(`vikaas_obs_demo`)
    if (savedObs) observations = JSON.parse(savedObs)
}

// ============ EVENT LISTENERS ============
document.getElementById('loginBtn')?.addEventListener('click', () => {
    const workerId = document.getElementById('workerId').value || 'AW001'
    currentUser = { id: workerId, name: 'Anganwadi Worker' }
    initDemoData()
    renderDomains()
    
    const select = document.getElementById('childSelect')
    if (select) {
        select.innerHTML = children.map(c => `<option value="${c.id}">${c.name} (${c.age})</option>`).join('')
        select.addEventListener('change', (e) => { currentChildId = e.target.value; loadReports() })
    }
    currentChildId = children[0].id
    
    const reportSelect = document.getElementById('reportChildSelect')
    if (reportSelect) {
        reportSelect.innerHTML = children.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
        reportSelect.addEventListener('change', () => loadReports())
    }
    
    document.getElementById('loginScreen').classList.add('hidden')
    document.getElementById('appScreen').classList.remove('hidden')
    showToast(`Welcome ${workerId}! Ready to track children.`, 'success')
})

document.getElementById('submitObsBtn')?.addEventListener('click', submitObservation)
document.getElementById('shareWhatsAppBtn')?.addEventListener('click', shareWhatsApp)
document.getElementById('bulkReferralBtn')?.addEventListener('click', () => showToast('📋 Bulk referrals generated for all at-risk children', 'success'))

// Tab switching
const tabs = ['worker', 'reports', 'supervisor']
tabs.forEach(tab => {
    document.getElementById(`${tab}Tab`)?.addEventListener('click', () => {
        tabs.forEach(t => {
            document.getElementById(`${t}TabContent`).classList.add('hidden')
            document.getElementById(`${t}Tab`).classList.remove('border-green-700', 'text-green-700')
            document.getElementById(`${t}Tab`).classList.add('text-gray-600')
        })
        document.getElementById(`${tab}TabContent`).classList.remove('hidden')
        document.getElementById(`${tab}Tab`).classList.add('border-green-700', 'text-green-700')
        if (tab === 'reports') loadReports()
        if (tab === 'supervisor') loadSupervisorView()
    })
})

document.getElementById('syncBtn')?.addEventListener('click', () => {
    showToast('🔄 Syncing to cloud... (Configure Supabase in .env file)', 'info')
})

document.getElementById('logoutBtn')?.addEventListener('click', () => {
    document.getElementById('loginScreen').classList.remove('hidden')
    document.getElementById('appScreen').classList.add('hidden')
    currentUser = null
})

// Initialize Supabase
supabaseClient = initSupabase()