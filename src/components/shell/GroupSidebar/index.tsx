// Adapted from: src/routes/(main)/group/_layout/Sidebar (LobeHub canary, slim)
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SideBarLayout from '@/components/shell/SideBarLayout';
import Footer from '@/components/shell/HomeSidebar/Footer';

import Body from './Body';
import Header from './Header';

const GroupSidebar = memo(() => (
  <Flexbox height="100%" style={{ overflow: 'hidden' }}>
    <SideBarLayout body={<Body />} header={<Header />} />
    <Footer />
  </Flexbox>
));

GroupSidebar.displayName = 'GroupSidebar';

export default GroupSidebar;
