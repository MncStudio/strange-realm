import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import HomeView from './views/HomeView.vue';
import CreateView from './views/CreateView.vue';
import JoinView from './views/JoinView.vue';
import RoomView from './views/RoomView.vue';
import './style.css';
import './motion.css';
import './story.css';
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: HomeView }, { path: '/create', component: CreateView },
  { path: '/join', component: JoinView }, { path: '/room/:roomId', component: RoomView },
  ...(import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === '1' ? [{ path: '/demo', component: () => import('./views/DemoView.vue') }] : []),
  { path: '/:pathMatch(.*)*', redirect: '/' }
] });
createApp(App).use(createPinia()).use(router).mount('#app');
