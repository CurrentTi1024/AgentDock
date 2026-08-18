// Adapted from: src/features/HomeSidebar + src/routes/(main)/home/_layout (LobeHub canary)
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SideBarLayout from '@/components/shell/SideBarLayout';

import Body from './Body';
import Footer from './Footer';
import Header from './Header';

const HomeSidebar = memo(() => (
  <Flexbox height="100%" style={{ overflow: 'hidden' }}>
    <SideBarLayout body={<Body />} header={<Header />} />
    <Footer />
  </Flexbox>
));

HomeSidebar.displayName = 'HomeSidebar';

export default HomeSidebar;
