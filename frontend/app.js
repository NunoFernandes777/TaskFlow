const API = window.API_URL || "/api";
let allTasks = [];
let currentFilter = "all";

async function fetchHealth() {
  try {
    const response = await fetch(`${API}/health`);
    const data = await response.json();
    const badge = document.getElementById("status-badge");
    badge.textContent = `API ${data.env} - v${data.version} - Redis ${data.redis}`;
    badge.className = data.status === "ok" ? "status-ok" : "status-err";
    document.getElementById("version-info").textContent =
      `TaskFlow v${data.version} - ${data.stats.totalCreated} creees, ${data.stats.totalCompleted} terminees`;
  } catch {
    const badge = document.getElementById("status-badge");
    badge.textContent = "API indisponible";
    badge.className = "status-err";
  }
}

async function fetchTasks() {
  try {
    const response = await fetch(`${API}/tasks`);
    const data = await response.json();
    allTasks = data.tasks || [];
    renderBoard();
  } catch (error) {
    console.error("Erreur lors du chargement des taches:", error);
  }
}

function setFilter(filter, buttonElement) {
  currentFilter = filter;
  document.querySelectorAll(".filter-btn").forEach((button) => button.classList.remove("active"));
  buttonElement.classList.add("active");
  renderBoard();
}

function getFilteredTasks() {
  if (currentFilter === "all") {
    return allTasks;
  }

  return allTasks.filter((task) => task.priority === currentFilter);
}

function renderBoard() {
  const filteredTasks = getFilteredTasks();
  const todoTasks = filteredTasks.filter((task) => task.status === "todo");
  const inProgressTasks = filteredTasks.filter((task) => task.status === "in-progress");
  const doneTasks = filteredTasks.filter((task) => task.status === "done");

  document.getElementById("count-todo").textContent = todoTasks.length;
  document.getElementById("count-inprogress").textContent = inProgressTasks.length;
  document.getElementById("count-done").textContent = doneTasks.length;
  document.getElementById("task-count").textContent = `${filteredTasks.length} tache(s)`;

  document.getElementById("stat-todo").textContent = allTasks.filter((task) => task.status === "todo").length;
  document.getElementById("stat-inprogress").textContent = allTasks.filter((task) => task.status === "in-progress").length;
  document.getElementById("stat-done").textContent = allTasks.filter((task) => task.status === "done").length;
  document.getElementById("stat-total").textContent = allTasks.length;

  document.getElementById("col-todo").innerHTML = todoTasks.map(createTaskCard).join("") || createEmptyState();
  document.getElementById("col-inprogress").innerHTML = inProgressTasks.map(createTaskCard).join("") || createEmptyState();
  document.getElementById("col-done").innerHTML = doneTasks.map(createTaskCard).join("") || createEmptyState();
}

function createTaskCard(task) {
  const priorityLabels = {
    low: "Basse",
    medium: "Moyenne",
    high: "Haute",
  };

  const priorityLabel = priorityLabels[task.priority] || task.priority;

  return `
    <div class="task-card prio-${task.priority}" id="task-${task.id}">
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ""}
      <div class="task-footer">
        <span class="prio-badge">${priorityLabel}</span>
        <select class="status-select" onchange="changeStatus('${task.id}', this.value)">
          <option value="todo" ${task.status === "todo" ? "selected" : ""}>A faire</option>
          <option value="in-progress" ${task.status === "in-progress" ? "selected" : ""}>En cours</option>
          <option value="done" ${task.status === "done" ? "selected" : ""}>Termine</option>
        </select>
        <button class="btn-icon btn-del" onclick="deleteTask('${task.id}')" title="Supprimer">x</button>
      </div>
    </div>
  `;
}

function createEmptyState() {
  return `
    <div class="empty">
      <div class="empty-icon">o</div>
      <div>Aucune tache</div>
    </div>
  `;
}

async function addTask() {
  const titleInput = document.getElementById("input-title");
  const descInput = document.getElementById("input-desc");
  const prioSelect = document.getElementById("input-prio");

  const title = titleInput.value.trim();
  const description = descInput.value.trim();
  const priority = prioSelect.value;

  if (!title) {
    titleInput.focus();
    return;
  }

  try {
    await fetch(`${API}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, priority }),
    });

    titleInput.value = "";
    descInput.value = "";
    fetchTasks();
    fetchHealth();
  } catch (error) {
    console.error("Erreur lors de l'ajout de la tache:", error);
  }
}

async function changeStatus(taskId, newStatus) {
  try {
    await fetch(`${API}/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchTasks();
    fetchHealth();
  } catch (error) {
    console.error("Erreur lors de la mise a jour du statut:", error);
  }
}

async function deleteTask(taskId) {
  if (window.confirm("Etes-vous sur de vouloir supprimer cette tache ?")) {
    try {
      await fetch(`${API}/tasks/${taskId}`, { method: "DELETE" });
      fetchTasks();
      fetchHealth();
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
    }
  }
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  };

  return text.replace(/[&<>"']/g, (character) => map[character]);
}

document.getElementById("input-title").addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    addTask();
  }
});

fetchHealth();
fetchTasks();
setInterval(fetchHealth, 30000);
