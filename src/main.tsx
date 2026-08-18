import 'antd/dist/reset.css';
import { ThemeProvider } from '@lobehub/ui';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/app/App';
import '@/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider appearance="light" customTheme={{ neutralColor: 'slate', primaryColor: 'blue' }} theme={{ cssVar: { key: 'agentdock-vars' } }}><BrowserRouter><App /></BrowserRouter></ThemeProvider></React.StrictMode>);
