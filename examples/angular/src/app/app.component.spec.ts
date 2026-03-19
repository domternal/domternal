import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  it('should create', () => {
    TestBed.configureTestingModule({ imports: [App] });
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
